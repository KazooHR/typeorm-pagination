import * as typeorm from "typeorm";
import { Like } from "typeorm";
import { findWithPagination } from "./findWithPagination";

import { getTestConnection, instrumentTestLogger } from "./testConnection";

@typeorm.Entity()
class Person {
  @typeorm.PrimaryGeneratedColumn("uuid")
  public id!: string;

  @typeorm.Column({ type: "text" })
  public name!: string;
}

@typeorm.Entity()
class Foo {
  @typeorm.PrimaryGeneratedColumn("uuid")
  public id!: string;

  @typeorm.Column({ type: "text" })
  public foo!: string;

  @typeorm.ManyToOne(() => Person, { nullable: true, eager: true })
  public owner?: Person;
}

@typeorm.Entity()
class Bar {
  @typeorm.PrimaryGeneratedColumn()
  public id!: number;

  @typeorm.Column({ type: "text" })
  public bar!: string;
}

let connection: typeorm.Connection;

beforeAll(async () => {
  connection = await getTestConnection([Foo, Bar, Person]);
});

afterAll(async () => {
  await connection.close();
});

afterEach(async () => {
  await connection.query("ROLLBACK").catch(() => {});
  jest.resetAllMocks();
});

describe("pagination", () => {
  beforeAll(async () => {
    const personRepository = connection.getRepository(Person);
    const ownerA = await personRepository.save({ name: "A" });
    const ownerB = await personRepository.save({ name: "B" });

    await connection.getRepository(Foo).insert([
      { foo: "page-test-a", owner: ownerA },
      { foo: "page-test-b", owner: ownerB },
      { foo: "page-test-c", owner: ownerA },
    ]);
  });

  it("finds the first page with default order", async () => {
    const fooRepository = connection.getRepository(Foo);
    const page = await findWithPagination(fooRepository, {
      select: ["foo"],
      where: { foo: Like("page-test-%") },
    });

    expect(page.edges.length).toEqual(3);
  });

  it("finds the last page with default order", async () => {
    const fooRepository = connection.getRepository(Foo);
    const page = await findWithPagination(fooRepository, {
      select: ["foo"],
      where: { foo: Like("page-test-%") },
      pagination: { last: 3 },
    });

    expect(page.edges.length).toEqual(3);
  });

  it("paginates a find query with custom order", async () => {
    const fooRepository = connection.getRepository(Foo);
    const page = await findWithPagination(fooRepository, {
      select: ["foo"],
      where: { foo: Like("page-test-%") },
      join: { alias: "f", innerJoin: { o: "f.owner" } },
      order: { "o.name": "DESC", foo: "DESC" },
      pagination: { first: 2 },
    });

    expect(page.edges[0].node).toEqual({ foo: "page-test-b" });
    expect(page.edges.length).toEqual(2);
    expect(page.pageInfo.hasNextPage).toBe(true);
  });

  it("eager loads relations by default", async () => {
    const { queries } = instrumentTestLogger(connection);

    const fooRepository = connection.getRepository(Foo);
    await findWithPagination(fooRepository, {
      pagination: { first: 1 },
    });

    expect(queries[0][0]).toContain(" JOIN ");
  });

  it("does not eager load when you ask nicely", async () => {
    const { queries } = instrumentTestLogger(connection);

    const fooRepository = connection.getRepository(Foo);
    await findWithPagination(fooRepository, {
      loadEagerRelations: false,
      pagination: { first: 1 },
    });

    expect(queries[0][0]).not.toContain(" JOIN ");
  });
});
