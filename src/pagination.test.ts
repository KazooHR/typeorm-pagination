import * as typeorm from "typeorm";

import { CursorPaginator, Page } from "./pagination";
import { getTestConnection } from "./testConnection";

@typeorm.Entity()
class Person {
  @typeorm.PrimaryGeneratedColumn("uuid")
  public id!: string;

  @typeorm.Column({ type: "text" })
  public name!: string;

  @typeorm.CreateDateColumn({ type: "timestamp with time zone" })
  public createdAt!: Date;
}

@typeorm.Entity()
class Foo {
  @typeorm.PrimaryGeneratedColumn()
  public id!: number;

  @typeorm.Column({ type: "text" })
  public foo!: string;

  @typeorm.ManyToOne(() => Person)
  public owner!: Person;

  @typeorm.Column({ type: "timestamp with time zone" })
  public timestamp!: Date;

  @typeorm.Column({ type: "timestamp with time zone", nullable: true })
  public deletedAt?: Date;
}

let connection: typeorm.Connection;

beforeAll(async () => {
  connection = await getTestConnection([Foo, Person]);
});

afterAll(async () => {
  await connection.close();
});

afterEach(jest.resetAllMocks);

function expectPage(page: Page<Foo>, fooValues: string[]) {
  expect(page.edges.map((item) => item.node.foo)).toEqual(fooValues);
}

describe("cursor paginator", () => {
  let insertResult: typeorm.InsertResult;
  let query: typeorm.SelectQueryBuilder<Foo>;

  beforeAll(async () => {
    const personRepository = connection.getRepository(Person);
    const ownerA = await personRepository.save({ name: "A" });
    const ownerB = await personRepository.save({ name: "B" });

    const fooRepository = connection.getRepository(Foo);
    insertResult = await fooRepository.insert([
      { owner: ownerB, foo: "a", timestamp: "2021-04-01" },
      { owner: ownerA, foo: "b", timestamp: "2021-03-01" },
      { owner: ownerB, foo: "c", timestamp: "2021-02-01" },
      { owner: ownerA, foo: "d", timestamp: "2021-01-01" },
      {
        owner: ownerB,
        foo: "e",
        timestamp: "2020-12-01",
        deletedAt: "2020-12-01",
      },
    ]);

    query = fooRepository
      .createQueryBuilder("f")
      .innerJoinAndSelect("f.owner", "o");
  });

  it("paginates in ascending order", async () => {
    const paginator = new CursorPaginator(query, {
      "o.name": "ASC",
      foo: "ASC",
    });

    const page = await paginator.page({ first: 3 });
    expectPage(page, ["b", "d", "a"]);
    expect(page.pageInfo.hasNextPage).toEqual(true);
    expect(page.pageInfo.hasPreviousPage).toEqual(false);
    expect(page.pageInfo.startCursor).toEqual("IkEifCJiInwy");
    expect(page.pageInfo.endCursor).toEqual("IkIifCJhInwx");

    const after = page.pageInfo.endCursor;
    const nextPage = await paginator.page({ first: 3, after });
    expect(nextPage.pageInfo.hasNextPage).toBe(false);
    expect(nextPage.pageInfo.hasPreviousPage).toBe(true);

    const before = page.pageInfo.endCursor;
    const firstPageBefore = await paginator.page({ first: 3, before });
    expectPage(firstPageBefore, ["b", "d"]);

    const lastPageBefore = await paginator.page({ last: 3, before });
    expectPage(lastPageBefore, ["d", "b"]);
  });

  it("paginates in descending order", async () => {
    const paginator = new CursorPaginator(query, {
      "o.name": "DESC",
      foo: "DESC",
      timestamp: "DESC",
    });

    const firstPage = await paginator.page({ first: 3 });
    expectPage(firstPage, ["e", "c", "a"]);

    const lastPage = await paginator.page({ last: 3 });
    expectPage(lastPage, ["b", "d", "a"]);
  });

  it("paginates in mixed order", async () => {
    const paginator = new CursorPaginator(query, {
      "o.name": "DESC",
      foo: "ASC",
    });

    const page = await paginator.page({ first: 3 });
    expectPage(page, ["a", "c", "e"]);
    expect(page.pageInfo.hasNextPage).toEqual(true);
    expect(page.pageInfo.hasPreviousPage).toEqual(false);

    const after = page.pageInfo.endCursor;
    const nextPage = await paginator.page({ first: 3, after });
    expectPage(nextPage, ["b", "d"]);
    expect(nextPage.pageInfo.hasNextPage).toBe(false);
    expect(nextPage.pageInfo.hasPreviousPage).toBe(true);

    const before = page.pageInfo.endCursor;
    const firstPageBefore = await paginator.page({ first: 3, before });
    expectPage(firstPageBefore, ["a", "c"]);

    const lastPageBefore = await paginator.page({ last: 3, before });
    expectPage(lastPageBefore, ["c", "a"]);
  });

  it("paginates between cursors", async () => {
    const paginator = new CursorPaginator(query, {
      "o.name": "ASC",
      foo: "ASC",
      timestamp: "ASC",
    });

    const page = await paginator.page({ first: 10 });
    const after = page.edges[0].cursor;
    const before = page.edges[4].cursor;

    const betweenPage = await paginator.page({ first: 3, after, before });
    expectPage(betweenPage, ["d", "a", "c"]);
  });

  it("paginates nulls with custom sort field", async () => {
    const _deletedAt = "COALESCE(deleted_at, DATE('0001-01-01'))";
    const paginator = new CursorPaginator(
      query,
      { _deletedAt: "ASC" },
      { _deletedAt }
    );

    const firstPage = await paginator.page({ first: 2 });
    expectPage(firstPage, ["a", "b"]);

    const secondPage = await paginator.page({
      first: 2,
      after: firstPage.pageInfo.endCursor,
    });
    expectPage(secondPage, ["c", "d"]);
  });

  it("counts", async () => {
    const paginator = new CursorPaginator(query);
    const page = await paginator.page({ first: 1 });
    const count = await page.pageInfo.totalCount();
    expect(count).toEqual(insertResult.identifiers.length);
  });

  it("disallows invalid options", async () => {
    const paginator = new CursorPaginator(query);
    jest.spyOn(paginator, "page").mockImplementation();

    // @ts-expect-error
    paginator.page({});

    // @ts-expect-error
    paginator.page({ first: 3, last: 3 });
  });

  it("aliases unmanaged columns", async () => {
    const { order }: any = new CursorPaginator(query, {
      doesNotExist: "ASC",
    });
    expect(order).toEqual({
      "f.doesNotExist": "ASC",
      "f.id": "ASC",
    });
  });
});

describe.only("cursor encoding safety", () => {
  let query: typeorm.SelectQueryBuilder<Foo>;

  beforeAll(async () => {
    const personRepository = connection.getRepository(Person);

    const ownerA = await personRepository.save({ name: "D" });

    const fooRepository = connection.getRepository(Foo);
    await fooRepository.insert([
      { owner: ownerA, foo: "foo|bar", timestamp: "2021-03-01" },
      { owner: ownerA, foo: "dood|ranch", timestamp: "2021-01-01" },
    ]);

    query = fooRepository
      .createQueryBuilder("f")
      .innerJoinAndSelect("f.owner", "o")
      .andWhere("owner_id = :ownerId", { ownerId: ownerA.id });
  });

  it("paginates properly", async () => {
    const paginator = new CursorPaginator(query, {
      "o.name": "ASC",
      foo: "ASC",
    });

    const page = await paginator.page({ first: 3 });
    expect(page.pageInfo.startCursor).toEqual("IkQifCJkb29kfHJhbmNoInw3");
    expect(page.pageInfo.endCursor).toEqual("IkQifCJmb298YmFyInw2");
  });

  it("paginates between cursors", async () => {
    const paginator = new CursorPaginator(query, {
      "o.name": "ASC",
      foo: "ASC",
      timestamp: "ASC",
    });

    const page = await paginator.page({ first: 10 });
    const after = page.edges[0].cursor;
    const before = page.edges[1].cursor;

    const betweenPage = await paginator.page({ first: 3, after, before });
    expectPage(betweenPage, ["d", "a", "c"]);
  });
});
