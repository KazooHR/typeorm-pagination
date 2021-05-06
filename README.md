# TypeORM Find and Paginate

Enables [Relay-style cursor pagination](https://relay.dev/graphql/connections.htm) over any TypeORM repository using the built-in [`find` options](https://github.com/typeorm/typeorm/blob/master/docs/find-options.md) and more!

In Kazoo's GraphQL layer, we use cursor pagination wherever feasible for the following benefits:

- Records are not duplicated when iterating over an entire, frequently changing, result set
- Each page is efficiently satisfied by a single query... including whether or not there is a next page!
- Results can be efficiently resumed before or after any individual result
- The last page is as fast as the first as long as cursor fields are indexed
- Relay-style cursor pagination is supported natively by Apollo Client

For more background on the UX and engineering tradeoffs, see https://uxdesign.cc/why-facebook-says-cursor-pagination-is-the-greatest-d6b98d86b6c0.

### What is cursor-based pagination?

Cursor-based pagination is means of paginating through large result sets from a particular record within that set. Your first request might not know any cursors. So your initial request looks something like:

```gql
{
  goals(input: { first: 1 }) {
    pageInfo {
      totalCount
      hasNextPage
      hasPreviousPage
    }
    edges {
      cursor
      node {
        id
        name
      }
    }
  }
}
```

You will receive data in the following shape:

```json
{
  "goalConnection": {
    "pageInfo": {
      "totalCount": 746,
      "hasNextPage": true,
      "hasPreviousPage": false
    },
    "edges": [{
      "cursor": "some-opaque-cursor-unique-to-this-record-in-this-result-set",
      "edge": {
        "id": "goal-id",
        "name": "Goal Name"
      }
    }]
  }
}
```

Your second request, to get the second item in the result set, would look like this:

```gql
{
  goals(input: { first: 1, after: "some-opaque-cursor-unique-to-this-record-in-this-result-set" }) {
    pageInfo {
      totalCount
      hasNextPage
      hasPreviousPage
    }
    edges {
      cursor
      node {
        id
        name
      }
    }
  }
}
```

For more information on how cursor-based pagination works, and how it's standardized for GraphQL, see https://relay.dev/docs/guides/graphql-server-specification/

### Examples

```ts
import { findWithPagination } from "@kazoohr/typeorm-pagination";

const page = await findWithPagination(goalRepository, {
  archived: false,
  join: { alias: "g", innerJoin: { o: "g.owner" } },
  order: { "o.name": "ASC", completed: "ASC" },
  pagination: { first: 10, after: "xyz=" },
});
```

Resulting in a page like this:

```jsonc
{
  "edges": [
    /* Array<{ node: T }> */
  ],
  "pageInfo": {
    "totalCount": 3,
    "hasNextPage": false,
    "hasPreviousPage": false,
    "startCursor": "IjExMWQzZDE1LWI5NGEtNGY3Yi1iZDE3LTZmYmVmZGQ4ZGQ3NyI=",
    "endCursor": "Ijk2MzhkZWM5LWVmZTEtNDQ2Zi05MjE3LTQ5OWY4ZTVkNDc2OSI="
  }
}
```

When paginating, all `order` fields must be non-null; see [Paginate by a Nullable Field](#paginate-by-a-nullable-field).

#### Build a More Complex Query

Pass a `builder` argument to [build your query](https://github.com/typeorm/typeorm/blob/master/src/query-builder/SelectQueryBuilder.ts) before execution. The second argument is a bag of convenience helpers that make it easier to build common queries.

```ts
await findWithPagination(fooRepository, {
  where: { foo: "testing" },
  builder(query, { bracket }) {
    query.leftJoin("Bar", "b");
    query.addSelect("'hello, world'", "_message");
    query.andWhere(bracket((q) => q.where("1 = :one").orWhere("1 = :two")));
    query.setParameters({ one: "1", two: "2" });
  },
});
```

#### Paginate by a Nullable Field

If you need to order by a nullable field, you need to coalesce that field into something that consistently sortable across pages. For example, given a nullable `deletedAt` column:

```ts
const page = await findWithPagination(fooRepository, {
  order: { sortableDeletedAt: "ASC" },
  pagination: { first, after },
  virtual: {
    sortableDeletedAt: "COALESCE(deleted_at, DATE('0001-01-01'))",
  },
});
```

### Testing

Just some internal notes for contributing to the tests.

#### Quickstart

`nvm use && yarn develop`

#### Statements

You can instrument the database to make assertions about the queries executed (and errors encountered).

```ts
import { instrumentTestLogger } from "./testConnection";

it("executes the expected query", () => {
  const { queries, errors } = instrumentTestLogger(connection);
  await findWithPagination(fooRepository, { where: { foo: "testing" } });
  expect(queries).toMatchInlineSnapshot(/* ... */);
  expect(errors).toEqual([]);
});
```

#### SQLite Types

The test connection uses in-memory SQLite for speed above all else. If your entity uses any types that aren't supported by SQLite, you'll need to map them in [sqliteTypes](./src/testConnection).

##### README.md Suggested Addtions 
- Define a compatible node type
- Define what is required for calling the method, what is optional, and what 
  are the defaults