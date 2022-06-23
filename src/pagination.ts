import { SelectQueryBuilder, WhereExpression, Brackets } from "typeorm";

// TODO: Delete me? It would be nice to not have to use a delimiter here... 🤔
const DELIMITER = "|";

type Query<T> = SelectQueryBuilder<T>;

type Direction = "ASC" | "DESC";

export type Order = Record<string, Direction>;

export type PageOptions = {
  first?: number;
  last?: number;
  after?: string;
  before?: string;
};

type PageMeta<T> = {
  pageSize: number;
  hasNext: boolean;
  hasPrevious: boolean;
  paginator: CursorPaginator<T>;
};

export type ValidatePageOptions<O extends PageOptions> = O extends {
  first: number;
  last: number;
}
  ? never
  : O extends { first: number; after?: string; before?: string }
  ? O
  : O extends { last: number; after?: string; before?: string }
  ? O
  : never;

type Row = Record<string, Date | string | number | object>;

class Edge<T> {
  constructor(
    public readonly node: T,
    protected options: { row: Row; paginator: CursorPaginator<T> }
  ) {}

  get cursor() {
    return this.options.paginator.cursor(this.options.row);
  }
}

/**
 * Represents a single page of results.
 */
export class Page<T> {
  constructor(
    protected result: { entities: T[]; raw: Row[] },
    protected meta: PageMeta<T>
  ) {}

  get edges(): Edge<T>[] {
    const { pageSize, paginator } = this.meta;
    const entities = this.result.entities.slice(0, pageSize);
    return entities.map((entity, index) => {
      const row = this.result.raw[index];
      return new Edge(entity, { row, paginator });
    });
  }

  get pageInfo() {
    return {
      totalCount: () => this.getTotalCount(),
      hasNextPage: this.meta.hasNext,
      hasPreviousPage: this.meta.hasPrevious,
      startCursor: this.startCursor,
      endCursor: this.endCursor,
    };
  }

  protected getTotalCount() {
    return this.meta.paginator.count();
  }

  protected get startCursor(): string | undefined {
    const firstItem = this.edges[0];
    return firstItem?.cursor;
  }

  protected get endCursor(): string | undefined {
    const [lastItem] = this.edges.slice(-1);
    return lastItem?.cursor;
  }
}

/**
 * Paginates through an ordered selection in a single query.
 */
export class CursorPaginator<T> {
  protected query: Query<T>;
  protected order: Order;
  protected virtual: Record<string, string | undefined>;

  /**
   * @param options.ordering The raw SQL columns to sort by (Ex: "foo", "r.bar").
   *   "id" is always included as the last ordering field as a tie-breaker.
   */
  constructor(
    query: Query<T>,
    order: Order = {},
    virtual: Record<string, string> = {}
  ) {
    query = query.clone();
    this.virtual = virtual;
    this.order = this.buildOrdering(query, order);
    this.query = this.applyOrdering(query);
  }

  /**
   * Execute a single query for the requested page of results.
   */
  async page<O extends PageOptions>({
    first,
    last,
    after,
    before,
  }: ValidatePageOptions<O>): Promise<Page<T>> {
    const pageSize = (first ?? last) as number;
    const query = this.query.clone();
    if (last) this.reverseOrdering(query);
    if (after) this.applyCursor(query, after);
    if (before) this.applyCursor(query, before, true);

    const result = await query.limit(pageSize + 1).getRawAndEntities();
    const hasMore = result.raw.length > pageSize;
    const hasNextAndPrevious =
      first !== undefined
        ? { hasNext: hasMore, hasPrevious: !!after }
        : { hasNext: !!before, hasPrevious: hasMore };

    return new Page(result, {
      pageSize,
      paginator: this,
      ...hasNextAndPrevious,
    });
  }

  /**
   * Encode a cursor for the given row.
   */
  cursor(row: Row) {
    return this.encodeCursor(row);
  }

  /**
   * Execute an additional query for the total number of rows.
   */
  count() {
    return this.query.getCount();
  }

  // QUERY INTERNALS - These all mutate the query in place.

  protected applyOrdering(query: Query<T>, order = this.order) {
    const columns = Array.from(Object.entries(order));
    columns.forEach(([column, direction], index) => {
      const expression = this.getColumnExpression(query, column);
      if (this.isVirtual(column)) {
        query.addSelect(expression, column);
      }

      if (index === 0) {
        query.orderBy(expression, direction);
      } else {
        query.addOrderBy(expression, direction);
      }
    });

    return query;
  }

  protected reverseOrdering(query: Query<T>) {
    const order: Order = {};
    Object.entries(this.order).forEach(([column, direction]) => {
      order[column] = direction === "ASC" ? "DESC" : "ASC";
    });

    return this.applyOrdering(query, order);
  }

  protected applyCursor(query: Query<T>, cursor: string, isBefore = false) {
    const columns = Object.keys(this.order);
    const position = this.decodeCursor(cursor);
    query.andWhere(
      new Brackets((where) =>
        this.applyWhere(query, where, {
          columns,
          position,
          index: 0,
          isBefore,
        })
      )
    );
  }

  /**
   * Given the ordering like...
   *
   * `{ priority: "DESC", due_date: "ASC" }`
   *
   * Apply a precise AND-where condition like...
   *
   * ```
   * priority <= :_after_0 AND (
   *   priority < :_after_0 OR (
   *     due_date >= :_after_1 AND (
   *       due_date > :_after_1
   *       OR id > :_after_2
   *     )
   *   )
   * )
   * ```
   */
  protected applyWhere(
    query: Query<T>,
    where: WhereExpression,
    {
      columns,
      position,
      index,
      isBefore,
    }: {
      columns: string[];
      position: unknown[];
      index: number;
      isBefore: boolean;
    }
  ) {
    const column = columns[index];
    const expression = this.getColumnExpression(query, column);
    const isReversed = this.order[column] === "DESC";
    const isDiscriminant = index >= columns.length - 1;

    // Build separate clauses for partial and total orders.
    const comparator = isBefore !== isReversed ? "<" : ">";
    const parameter = isBefore ? `_before_${index}` : `_after_${index}`;
    const totalOrder = `${expression} ${comparator} :${parameter}`;
    const partialOrder = `${expression} ${comparator}= :${parameter}`;
    query.setParameter(parameter, position[index]);

    // The last sort field is always "id", which acts as the discriminant.
    if (isDiscriminant) {
      where.where(totalOrder);
    } else {
      where.where(partialOrder).andWhere(
        new Brackets((andWhere) =>
          andWhere.where(totalOrder).orWhere(
            new Brackets((orWhere) =>
              this.applyWhere(query, orWhere, {
                columns,
                position,
                index: index + 1,
                isBefore,
              })
            )
          )
        )
      );
    }
  }

  /**
   * Safely quote identifiers for Postgres, stripping out any pre-existing double quotes.
   *
   * > There is a second kind of identifier: the delimited identifier or quoted identifier.
   * > It is formed by enclosing an arbitrary sequence of characters in double-quotes (").
   *
   * https://www.postgresql.org/docs/9.1/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS
   */
  protected escapeColumn(query: Query<T>, column: string) {
    return column
      .replace('"', "")
      .split(".")
      .map(query.connection.driver.escape)
      .join(".");
  }

  /**
   * Virtual columns are raw expressions we use as pagination offsets.
   *
   * Because of TypeORM's lack of support for Common Table Expressions,
   * we also need to compile these columns into the WHERE clauses verbatim.
   */
  protected isVirtual(property: string) {
    return !!this.virtual[property];
  }

  protected getColumnExpression(query: Query<T>, column: string) {
    return this.virtual[column] ?? this.escapeColumn(query, column);
  }

  // CURSOR INTERNALS

  protected buildOrdering(query: Query<T>, order: Order): Order {
    const baseOrder: Order = { ...order, id: "ASC" };
    const builtOrder: Order = {};
    for (const property in baseOrder) {
      const direction = baseOrder[property];

      const isAliased = property.includes(".");
      const isVirtual = this.isVirtual(property);
      if (isAliased || isVirtual) {
        builtOrder[property] = direction;
        continue;
      }

      // Convert entity properties to database columns
      const alias = query.expressionMap.mainAlias;
      const meta = alias?.metadata?.findColumnWithPropertyName(property);
      const column = meta?.databaseName || property;

      // Default to the main column to avoid conflicts.
      builtOrder[`${alias?.name}.${column}`] = direction;
    }

    return builtOrder;
  }

  /**
   * Given a cursor, transforms it into its underlying data so that we can use
   * it to find the next set of results.
   */
  protected decodeCursor(cursor: string): string[] {
    return JSON.parse(cursor).map((item: string) => JSON.parse(item));
  }

  /**
   * Given a set of data that points to a specific row in the database, this
   * function returns an opaque, encoded cursor that users can utilize to
   * paginate through results.
   */
  protected encodeCursor(row: Row): string {
    const data = Object.keys(this.order).map((column) => {
      const property = column.replace(".", "_");
      // Fall back to null so missing columns don't blow up the decoder.
      return JSON.stringify(row[property] || null);
    });

    return JSON.stringify(data);
  }
}
