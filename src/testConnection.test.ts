import * as typeorm from "typeorm";

import { getTestConnection } from "./testConnection";

@typeorm.Entity()
export default class Foo {
  @typeorm.PrimaryGeneratedColumn("uuid")
  public id!: string;

  @typeorm.Column({ type: "text" })
  public multiWordField!: string;

  @typeorm.CreateDateColumn({ type: "timestamp with time zone" })
  public createdAt!: Date;

  @typeorm.Column({ type: "json" })
  public metadata!: object;

  @typeorm.Column({ type: "int", array: true })
  public multiValuedColumn!: number[];

  @typeorm.Column({ type: "int", default: 0 })
  public intWithDefault!: number;

  @typeorm.Column({ type: "text", default: "test" })
  public textWithDefault!: string;

  @typeorm.Column({ type: "timestamp with time zone", default: () => "now()" })
  public timeWithNowDefault!: Date;
}

let connection: typeorm.Connection;

beforeAll(async () => {
  connection = await getTestConnection([Foo]);
});

test("automatically names fields", async () => {
  const [id, multiWordField] = await connection.query("PRAGMA table_info(foo)");
  expect(id.name).toEqual("id");
  expect(multiWordField.name).toEqual("multi_word_field");
});

test("substitutes sqlite types", async () => {
  const tableInfo: any[] = await connection.query("PRAGMA table_info(foo)");
  const [createdAtField] = tableInfo.filter((c) => c.name === "created_at");
  expect(createdAtField.type).toEqual("datetime");
});

test("emulates Postgres fields", async () => {
  const expectedFoo = new Foo();
  expectedFoo.metadata = { foo: "bar " };
  expectedFoo.multiWordField = "Hello World";
  expectedFoo.multiValuedColumn = [1, 2];

  const repository = connection.getRepository(Foo);
  await repository.insert(expectedFoo);

  const actualFoo = await connection.getRepository(Foo).findOne(expectedFoo.id);
  expect(actualFoo).toEqual({
    createdAt: expect.any(Date),
    id: expect.any(String),
    intWithDefault: 0,
    metadata: { foo: "bar " },
    multiValuedColumn: [1, 2],
    multiWordField: "Hello World",
    textWithDefault: "test",
    timeWithNowDefault: expect.any(Date),
  });
});

test("converts array fields to text columns to be filled with JSON values", async () => {
  const tableInfo: any[] = await connection.query("PRAGMA table_info(foo)");
  const [multiValuedColumnField] = tableInfo.filter(
    (c) => c.name === "multi_valued_column"
  );
  expect(multiValuedColumnField.type).toEqual("text array");
});
