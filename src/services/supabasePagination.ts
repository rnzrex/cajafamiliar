import type { SupabaseClient } from "@supabase/supabase-js";
import { RemoteAppDataLoadError } from "./dataRepositoryErrors";

export interface OrderSpec {
  column: string;
  ascending?: boolean;
}

export interface FetchAllOptions {
  supabase: SupabaseClient;
  table: string;
  householdId: string;
  orders: OrderSpec[];
  pageSize?: number;
  pkField?: string;
}

/**
 * Fetches all rows exhaustively for a Supabase table by household_id using explicit range pagination.
 *
 * Rules:
 * - Range limits are inclusive (0..999, 1000..1999).
 * - Page size defaults to 1000.
 * - Iterates until page.length < pageSize.
 * - Deduplicates fetched rows by PK field (defaulting to "id", or "debt_id" for credit_card_profiles).
 * - Any error on any page throws RemoteAppDataLoadError(table, originalError).
 */
export async function fetchAllSupabaseRows<T = any>({
  supabase,
  table,
  householdId,
  orders,
  pageSize = 1000,
  pkField = "id",
}: FetchAllOptions): Promise<T[]> {
  const allRows: T[] = [];
  const seenPks = new Set<string | number>();
  let pageIndex = 0;

  while (true) {
    const from = pageIndex * pageSize;
    const to = from + pageSize - 1;

    let query = supabase.from(table).select("*").eq("household_id", householdId);

    for (const order of orders) {
      query = query.order(order.column, { ascending: order.ascending ?? true });
    }

    query = query.range(from, to);

    const { data, error } = await query;

    if (error) {
      throw new RemoteAppDataLoadError(table, error);
    }

    const rows = (data ?? []) as T[];
    for (const row of rows) {
      const pk = (row as any)?.[pkField];
      if (pk !== undefined && pk !== null) {
        if (seenPks.has(pk)) continue;
        seenPks.add(pk);
      }
      allRows.push(row);
    }

    if (rows.length < pageSize) {
      break;
    }

    pageIndex++;
  }

  return allRows;
}
