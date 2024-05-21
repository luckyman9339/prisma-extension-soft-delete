import { Prisma } from "@prisma/client";

export type TrashedOption = "all" | "only" | "except"
// Now, define the NestedOption interface using a mapped type
// Using keyof operator to get the keys as union of strings
export type ItemType = keyof typeof Prisma.ModelName

export type MODEL_TYPE = Uncapitalize<ItemType>

export type ModelConfig = {
  field: string;
  createValue: (deleted: boolean) => any;
  allowToOneUpdates?: boolean;
  allowCompoundUniqueIndexWhere?: boolean;
  queryOption?: TrashedOption;
  nestModels?: {
    [key in Prisma.ModelName]?: boolean
  },
  forceDelete?: boolean
};

export type Config = {
  models: Partial<Record<Prisma.ModelName, ModelConfig | boolean>>;
  defaultConfig?: ModelConfig;
};