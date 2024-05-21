import faker from "faker";

import { createSoftDeleteExtension } from "../../src";
import { MockClient } from "./utils/mockClient";

describe("config", () => {
  it('does not soft delete models where config is passed as "false"', async () => {
    const client = new MockClient();
    const extendedClient = client.$extends(
      createSoftDeleteExtension({
        models: {
          User: false,
        },
      })
    );

    await extendedClient.post.update({
      where: { id: 1 },
      data: {
        author: { delete: true },
        comments: {
          updateMany: {
            where: { content: faker.lorem.sentence() },
            data: { content: faker.lorem.sentence() },
          },
        },
      },
    });

    expect(client.post.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        author: { delete: true },
        comments: {
          updateMany: {
            where: { content: expect.any(String) },
            data: { content: expect.any(String) },
          },
        },
      },
    });
  });

  it("allows setting default config values", async () => {
    const deletedAt = new Date();
    const content1 = faker.lorem.sentence()
    const content2 = faker.lorem.sentence()
    const client = new MockClient();
    const extendedClient = client.$extends(
      createSoftDeleteExtension({
        models: {
          Post: true,
          Comment: true,
        },
        defaultConfig: {
          field: "deletedAt",
          createValue: () => deletedAt,
        },
      })
    );

    await extendedClient.user.update({
      where: { id: 1 },
      data: {
        posts: {
          delete: { id: 1 },
        },
        comments: {
          updateMany: {
            where: { content: content1 },
            data: { content: content2 },
          },
        },
      },
    });

    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        posts: {
          update: { where: { id: 1, deletedAt }, data: { deletedAt } },
        },
        comments: {
          updateMany: {
            where: {
              content: content1,
              deletedAt,
            },
            data: { content: content2 },
          },
        },
      },
    });
  });

  it('throws when default config does not have a "field" property', () => {
    expect(() => {
      createSoftDeleteExtension({
        models: {
          Post: true,
        },
        // @ts-expect-error - we are testing the error case
        defaultConfig: {
          createValue: () => new Date(),
        },
      });
    }).toThrowError(
      "prisma-extension-soft-delete: defaultConfig.field is required"
    );
  });

  it('throws when default config does not have a "createValue" property', () => {
    expect(() => {
      createSoftDeleteExtension({
        models: {
          Post: true,
        },
        // @ts-expect-error - we are testing the error case
        defaultConfig: {
          field: "deletedAt",
        },
      });
    }).toThrowError(
      "prisma-extension-soft-delete: defaultConfig.createValue is required"
    );
  });

  it("allows setting model specific config values", async () => {
    const deletedAt = new Date();
    const content1 = faker.lorem.sentence()
    const content2 = faker.lorem.sentence()
    const client = new MockClient();
    const extendedClient = client.$extends(
      createSoftDeleteExtension({
        models: {
          Post: {
            field: "deletedAt",
            createValue: () => deletedAt,
          },
          Comment: true,
        },
      })
    );

    await extendedClient.user.update({
      where: { id: 1 },
      data: {
        posts: { delete: { id: 1 } },
        comments: {
          updateMany: {
            where: { content: content1 },
            data: { content: content2 },
          },
        },
      },
    });

    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        posts: {
          update: { where: { id: 1, deletedAt }, data: { deletedAt } },
        },
        comments: {
          updateMany: {
            where: { deleted: false, content: content1, },
            data: { content: content2 },
          },
        },
      },
    });
  });

  it("allows overriding default config values", async () => {
    const deletedAt = new Date();
    const content1 = faker.lorem.sentence()
    const content2 = faker.lorem.sentence()
    const client = new MockClient();
    const extendedClient = client.$extends(
      createSoftDeleteExtension({
        models: {
          Post: true,
          Comment: {
            field: "deleted",
            createValue: Boolean,
          },
        },
        defaultConfig: {
          field: "deletedAt",
          createValue: (deleted) => {
            if (deleted) return deletedAt;
            return null;
          },
        },
      })
    );

    await extendedClient.user.update({
      where: { id: 1 },
      data: {
        posts: { delete: { id: 1 } },
        comments: {
          updateMany: {
            where: { content: content1 },
            data: { content: content2 },
          },
        },
      },
    });

    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        posts: {
          update: { where: { id: 1, deletedAt: null }, data: { deletedAt } },
        },
        comments: {
          updateMany: {
            where: { deleted: false, content: content1 },
            data: { content: content2 },
          },
        },
      },
    });
  });
});
