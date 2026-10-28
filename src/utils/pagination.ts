import { Request } from "express";

export interface PageQuery {
  page: number;
  limit: number;
  skip: number;
}

export function pageQuery(req: Request, defaultLimit = 50, maxLimit = 500): PageQuery {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function paged<T>(items: T[], total: number, q: PageQuery) {
  return { items, total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)) };
}
