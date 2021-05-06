import {
  FindOptionsUtils as Find,
  FindConditions,
  FindManyOptions,
  Repository,
  ObjectLiteral,
  SelectQueryBuilder,
} from "typeorm";

import { CursorPaginator, Order, Page, PageOptions } from "./pagination";

export type FindOptions<T = any> = (FindManyOptions<T> | FindConditions<T>) & {
  builder?: (query: SelectQueryBuilder<T>) => void | SelectQueryBuilder<T>;
  order?: FindManyOptions<T>["order"] & Order;
  pagination?: PageOptions;
  virtual?: Record<string, string>;
};

/**
 * Wraps the internal TypeORM `find` query builder with cursor pagination.
 *
 * When paginating, the default limit is the first 100 results.
 *
 * When both `first` and `last` are provided, `first` is discarded.
 *
 * References https://github.com/typeorm/typeorm/blob/f47b8773bf89851d12a608fa6d65df44aee856a2/src/entity-manager/EntityManager.ts#L665.
 *
 * @throws a runtime error when aliased `order` columns do not exist in the query.
 */
export function findWithPagination<
  T extends ObjectLiteral,
  O extends FindOptions<T>
>(
  repository: Repository<T>,
  options: FindOptions<T>,
  Paginator: typeof CursorPaginator = CursorPaginator)
  : Promise<Page<T>> {
  const metadata = repository.metadata;
  const { order = {}, pagination = {}, virtual, ...baseOptions } = options;
  const alias = Find.extractFindManyOptionsAlias(baseOptions) || metadata.name;
  const query = repository.createQueryBuilder(alias);
  // Eager relations are always loaded by default.
  const loadEagerByDefault = !Find.isFindManyOptions(baseOptions);

  const loadEagerByFindOptions = options.loadEagerRelations !== false;
  if (loadEagerByDefault || loadEagerByFindOptions) {
   /*
    not quite sure eager loading is fully working, joins are added but
    not selects

    */
    Find.joinEagerRelations(query, query.alias, metadata);
  }

  // With pagination, TypeORM can build everything but the ordering.
  // We need to order by join columns and append the PK as a tiebreaker.
  buildBaseQuery(query, baseOptions);

  const paginator = new Paginator(query, order, virtual);
  const { first = 100, last, after, before } = pagination;
  const pageOptions = last ? { last, after, before } : { first, after, before };
  return paginator.page(pageOptions);
}

function buildBaseQuery<T>(
  query: SelectQueryBuilder<T>,
  { builder, ...baseOptions }: Exclude<FindOptions<T>, "pagination">
) {
  Find.applyFindManyOptionsOrConditionsToQueryBuilder<T>(query, baseOptions);

  builder?.(query);
}

