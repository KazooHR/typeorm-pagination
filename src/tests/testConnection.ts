import * as typeorm from "typeorm";
import { SnakeNamingStrategy } from "typeorm-naming-strategies";

const SQLITE_TYPES: Map<typeorm.ColumnType, typeorm.ColumnType> = new Map([
  ["timestamp with time zone", "datetime"],
  ["enum", "text"],
  ["json", "text"],
  ["jsonb", "text"],
  ["char", "text"],
  ["money", "decimal"],
]);

/**
 * Set up an in-memory SQLite3 connection for testing.
 */
export const getTestConnection = (
  entities: Function[],
  name = "default",
  logging = false,
  dropSchema = true,
  synchronize = true
) =>
  typeorm.createConnection({
    name,
    type: "sqlite",
    database: ":memory:",
    entities: conformEntities(entities),
    logging,
    dropSchema,
    synchronize,
    namingStrategy: new SnakeNamingStrategy(),
  });

/**
 * Replace Postgres-specific types with compatible SQLite types for testing.
 */
function conformEntities(entities: Function[]) {
  const metadata = typeorm.getMetadataArgsStorage();
  entities
    .map((entity) => {
      const columns = metadata.filterColumns(entity);

      let parentEntity = Object.getPrototypeOf(entity);
      while (parentEntity) {
        const parentColumns = metadata.filterColumns(parentEntity);
        parentEntity = Object.getPrototypeOf(parentEntity);
        columns.push(...parentColumns);
      }

      return columns;
    })
    .reduce((a, b) => a.concat(b), [])
    .forEach((column) => {
      const postgresType = column.options.type as typeorm.ColumnType;
      const sqliteType = SQLITE_TYPES.get(postgresType);
      if (sqliteType) {
        column.options.type = sqliteType;
      }

      const jsonTransformer = {
        to: (jsVal: any) => JSON.stringify(jsVal),
        from: (dbVal: string) => JSON.parse(dbVal),
      };

      /* istanbul ignore next - testing code */
      if (postgresType === "jsonb" || postgresType === "json") {
        column.options.transformer = jsonTransformer;
      }

      // This option is _only_ supported for Postgres, so we have to emulate it in SQLite
      if (column.options.array) {
        column.options.type = "text";
        column.options.transformer = jsonTransformer;
      }

      if (typeof column.options.default !== "undefined") {
        column.options.default = handleDefaultTransformation(
          column.options.default
        );
      }
    });

  return entities;
}

/**
 * Instrument the connection to log all queries and errors.
 */
export function instrumentTestLogger(connection: typeorm.Connection) {
  const queries: Array<[string, unknown[] | undefined]> = [];
  const errors: Error[] = [];
  Object.assign(connection, {
    logger: {
      logQuery(statement: string, parameters?: unknown[]) {
        queries.push([statement, parameters]);
      },
      logQueryError(error: Error) {
        errors.push(error);
      },
    },
  });

  return { queries, errors };
}

function handleDefaultTransformation(defaultValue: unknown) {
  // Values can be of different types, need to resolve to string if possible
  const newValue =
    typeof defaultValue === "function" ? defaultValue() : defaultValue;

  // We skip processing and return original value if we can't resolve to string
  if (typeof newValue === "string") {
    // In Postgres CURRENT_TIMESTAMP canonicalizes to now(), but SQLite doesn't recognize now()
    return newValue.replace("now()", "CURRENT_TIMESTAMP");
  }

  return newValue;
}
