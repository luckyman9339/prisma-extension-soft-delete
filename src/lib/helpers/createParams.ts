import { Prisma } from "@prisma/client";
import { NestedParams } from "prisma-extension-nested-operations";

import { ItemType, ModelConfig } from "../types";
import { addDeletedToSelect } from "../utils/nestedReads";

const uniqueFieldsByModel: Record<string, string[]> = {};
const uniqueIndexFieldsByModel: Record<string, string[]> = {};

function isEmptyObject(obj: any): boolean {
  return Object.keys(obj).length === 0 && obj.constructor === Object;
}

Prisma.dmmf.datamodel.models.forEach((model) => {
  // add unique fields derived from indexes
  const uniqueIndexFields: string[] = [];
  model.uniqueFields.forEach((field) => {
    uniqueIndexFields.push(field.join("_"));
  });
  uniqueIndexFieldsByModel[model.name] = uniqueIndexFields;

  // add id field and unique fields from @unique decorator
  const uniqueFields: string[] = [];
  model.fields.forEach((field) => {
    if (field.isId || field.isUnique) {
      uniqueFields.push(field.name);
    }
  });
  uniqueFieldsByModel[model.name] = uniqueFields;
});

export type Params = Omit<NestedParams<any>, "operation"> & {
  operation: string;
};

export type CreateParamsReturn = {
  params: Params;
  ctx?: any;
};

export type CreateParams = (
  config: ModelConfig,
  params: Params,
) => CreateParamsReturn;

const getInclude = (config: ModelConfig, params: any) => {
  let include = {}

  if (isEmptyObject(config.nestModels)) {
    include = params.args?.include || {}
  } else {
    Object.keys(config.nestModels || {}).forEach(item => {
      const key = item as ItemType
      Object.keys(params.args?.include || {}).forEach(model => {
        const where = params.args?.include[model]?.where || {}
        if (model.toLowerCase().includes(key.toLowerCase())) {
          if (config.nestModels![key]) {
            include = { ...include, [model]: { where } }
          } else {
            include = { ...include, [model]: { where: { ...where, [config.field]: config.createValue(false) } } }
          }
        }
      })
    })
  }

  return include
}

const getWhere = (config: ModelConfig, params: any) => {
  const args = params.args || {};
  let where = args?.where || {};

  switch (config.queryOption) {
    case "all":
      break
    case "only":
      where = {
        ...where,
        [config.field]: { not: config.createValue(false) }
      }
      break
    default: // except
      where = {
        ...where,
        [config.field]: where[config.field] || config.createValue(false)
      }
  }
  return where
}

const getNewWhere = (config: ModelConfig, where: any) => {
  let newWhere = {}
  switch (config.queryOption) {
    case "all":
      newWhere = { ...where }
      break
    case "only":
      newWhere = {
        ...where,
        [config.field]: { not: config.createValue(false) }
      }
      break
    default: // except
      newWhere = {
        ...where,
        [config.field]: config.createValue(false)
      }
  }
  return newWhere
}

export const createDeleteParams: CreateParams = (
  config,
  params
) => {
  if (
    !params.model ||
    // do nothing for delete: false
    (typeof params.args === "boolean" && !params.args) ||
    // do nothing for root delete without where to allow Prisma to throw
    (!params.scope && !params.args?.where)
  ) {
    return {
      params,
    };
  }

  if (typeof params.args === "boolean") {
    return {
      params: {
        ...params,
        operation: config.forceDelete ? "delete" : "update",
        args: {
          __passUpdateThrough: true,
          [config.field]: config.createValue(true),
        },
      },
    };
  }

  let where = params.args?.where || params.args;
  where = getNewWhere(config, where)

  return {
    params: {
      ...params,
      operation: config.forceDelete ? "delete" : "update",
      args: {
        where,
        data: {
          [config.field]: config.createValue(true),
        },
      },
    },
  };
};

export const createDeleteManyParams: CreateParams = (config, params) => {
  if (!params.model) return { params };

  let where = params.args?.where || params.args;

  where = getNewWhere(config, where)

  if (config.forceDelete) {
    return {
      params: {
        ...params,
        operation: "deleteMany",
        args: {
          where
        }
      }
    }
  } else {
    return {
      params: {
        ...params,
        operation: "updateMany",
        args: {
          where,
          data: {
            [config.field]: config.createValue(true),
          },
        },
      },
    };
  }
};

export const createUpdateParams: CreateParams = (config, params) => {
  if (
    params.scope?.relations &&
    !params.scope.relations.to.isList &&
    !config.allowToOneUpdates &&
    !params.args?.__passUpdateThrough
  ) {
    throw new Error(
      `prisma-extension-soft-delete: update of model "${params.model}" through "${params.scope?.parentParams.model}.${params.scope.relations.to.name}" found. Updates of soft deleted models through a toOne relation is not supported as it is possible to update a soft deleted record.`
    );
  }

  // remove __passUpdateThrough from args
  if (params.args?.__passUpdateThrough) {
    delete params.args.__passUpdateThrough;
  }

  return { params };
};

export const createUpdateManyParams: CreateParams = (config, params) => {
  // do nothing if args are not defined to allow Prisma to throw an error
  if (!params.args) return { params };

  return {
    params: {
      ...params,
      args: {
        ...params.args,
        where: {
          ...params.args?.where,
          // allow overriding the deleted field in where
          [config.field]:
            params.args?.where?.[config.field] || config.createValue(false),
        },
      },
    },
  };
};

export const createUpsertParams: CreateParams = (_, params) => {
  if (params.scope?.relations && !params.scope.relations.to.isList) {
    throw new Error(
      `prisma-extension-soft-delete: upsert of model "${params.model}" through "${params.scope?.parentParams.model}.${params.scope.relations.to.name}" found. Upserts of soft deleted models through a toOne relation is not supported as it is possible to update a soft deleted record.`
    );
  }

  return { params };
};

function validateFindUniqueParams(params: Params, config: ModelConfig): void {
  const uniqueIndexFields = uniqueIndexFieldsByModel[params.model || ""] || [];
  const uniqueIndexField = Object.keys(params.args?.where || {}).find((key) =>
    uniqueIndexFields.includes(key)
  );

  // when unique index field is found it is not possible to use findFirst.
  // Instead warn the user that soft-deleted models will not be excluded from
  // this query unless warnForUniqueIndexes is false.
  if (uniqueIndexField && !config.allowCompoundUniqueIndexWhere) {
    throw new Error(
      `prisma-extension-soft-delete: query of model "${params.model}" through compound unique index field "${uniqueIndexField}" found. Queries of soft deleted models through a unique index are not supported. Set "allowCompoundUniqueIndexWhere" to true to override this behaviour.`
    );
  }
}


function shouldPassFindUniqueParamsThrough(
  params: Params,
  config: ModelConfig
): boolean {
  const uniqueFields = uniqueFieldsByModel[params.model || ""] || [];
  const uniqueIndexFields = uniqueIndexFieldsByModel[params.model || ""] || [];
  const uniqueIndexField = Object.keys(params.args?.where || {}).find((key) =>
    uniqueIndexFields.includes(key)
  );

  // pass through invalid args so Prisma throws an error
  return (
    // findUnique must have a where object
    !params.args?.where ||
    typeof params.args.where !== "object" ||
    // where object must have at least one defined unique field
    !Object.entries(params.args.where).some(
      ([key, val]) =>
        (uniqueFields.includes(key) || uniqueIndexFields.includes(key)) &&
        typeof val !== "undefined"
    ) ||
    // pass through if where object has a unique index field and allowCompoundUniqueIndexWhere is true
    !!(uniqueIndexField && config.allowCompoundUniqueIndexWhere)
  );
}

//checked
export const createFindUniqueParams: CreateParams = (config, params) => {
  if (shouldPassFindUniqueParamsThrough(params, config)) {
    return { params };
  }

  validateFindUniqueParams(params, config);
  const where = getWhere(config, params);
  const include = getInclude(config, params);
  const args = { ...params.args, where, ...(isEmptyObject(include) ? {} : { include }) };

  return {
    params: {
      ...params,
      operation: "findFirst",
      args,
    },
  };
};


export const createFindUniqueOrThrowParams: CreateParams = (config, params) => {
  if (shouldPassFindUniqueParamsThrough(params, config)) {
    return { params };
  }

  validateFindUniqueParams(params, config);

  const where = getWhere(config, params)
  const include = getInclude(config, params)
  const args = { ...params.args, where, ...(isEmptyObject(include) ? {} : { include }) };

  return {
    params: {
      ...params,
      operation: "findFirstOrThrow",
      args
    },
  };
};

export const createFindFirstParams: CreateParams = (config, params) => {
  const where = getWhere(config, params)
  const include = getInclude(config, params)
  const args = { ...params.args, where, ...(isEmptyObject(include) ? {} : { include }) };

  return {
    params: {
      ...params,
      operation: "findFirst",
      args
    },
  };
};

export const createFindFirstOrThrowParams: CreateParams = (config, params) => {
  const where = getWhere(config, params)
  const include = getInclude(config, params)
  const args = { ...params.args, where, ...(isEmptyObject(include) ? {} : { include }) };

  return {
    params: {
      ...params,
      operation: "findFirstOrThrow",
      args
    },
  };
};

// Checked
export const createFindManyParams: CreateParams = (config, params) => {
  const where = getWhere(config, params)
  const include = getInclude(config, params)

  return {
    params: {
      ...params,
      operation: "findMany",
      args: { ...params.args, where, ...(isEmptyObject(include) ? {} : { include }) }
    },
  };
};

/*GroupBy */
export const createGroupByParams: CreateParams = (config, params) => {
  const where = getWhere(config, params)

  return {
    params: {
      ...params,
      operation: "groupBy",
      args: {
        ...params.args,
        where
      },
    },
  };
};

export const createCountParams: CreateParams = (config, params) => {
  const args = params.args || {};
  const where = getWhere(config, params)

  return {
    params: {
      ...params,
      args: {
        ...args,
        where,
      },
    },
  };
};

export const createAggregateParams: CreateParams = (config, params) => {
  const args = params.args || {};
  const where = getWhere(config, params)

  return {
    params: {
      ...params,
      args: {
        ...args,
        where
      },
    },
  };
};

export const createWhereParams: CreateParams = (config, params) => {
  if (!params.scope) return { params };

  // customise list queries with every modifier unless the deleted field is set
  if (params.scope?.modifier === "every" && !params.args[config.field]) {
    return {
      params: {
        ...params,
        args: {
          OR: [
            { [config.field]: { not: config.createValue(false) } },
            params.args,
          ],
        },
      },
    };
  }

  const where = getNewWhere(config, params.args)

  return {
    params: {
      ...params,
      args: {
        ...where
      },
    },
  };
};

export const createSelectParams: CreateParams = (config, params) => {
  // selects in includes are handled by createIncludeParams
  if (params.scope?.parentParams.operation === "include") {
    return { params };
  }

  // selects of toOne relation cannot filter deleted records using params
  if (params.scope?.relations?.to.isList === false) {
    if (params.args?.select && !params.args.select[config.field]) {
      return {
        params: addDeletedToSelect(params, config),
        ctx: { deletedFieldAdded: true },
      };
    }

    return { params };
  }

  const where = getWhere(config, params)

  return {
    params: {
      ...params,
      args: {
        ...params.args,
        where
      },
    },
  };
};

