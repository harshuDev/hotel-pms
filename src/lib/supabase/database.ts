import type { Database as Generated } from "@/lib/database.types";

/**
 * The generated types, with one correction.
 *
 * Supabase's generator types an RPC parameter that has a SQL DEFAULT as
 * optional — `p_id?: string` — and never as nullable. PostgREST accepts an
 * explicit null for every one of them, and null is not the same as leaving the
 * parameter out: omitting it uses the SQL default, passing null passes NULL.
 *
 * Every null this codebase passes happens to go to a parameter whose SQL
 * default is also null, so today the two agree. Rewriting the call sites to
 * `undefined` would make the code depend on that agreement, and the day
 * someone writes `default 0` the call would quietly take the default where
 * NULL was meant. Widening the optional arguments is the smaller and more
 * honest fix: the call sites keep saying what they mean.
 *
 * Nothing else is relaxed. Parameter names, required parameters, enum values,
 * table columns and every Returns shape stay exactly as generated.
 */
type NullableOptionals<T> = {
  [K in keyof T]: undefined extends T[K] ? T[K] | null : T[K];
};

type WidenArgs<F> = {
  [K in keyof F]: F[K] extends { Args: infer A }
    ? Omit<F[K], "Args"> & { Args: NullableOptionals<A> }
    : F[K];
};

export type Database = Omit<Generated, "public"> & {
  public: Omit<Generated["public"], "Functions"> & {
    Functions: WidenArgs<Generated["public"]["Functions"]>;
  };
};

/** Every RPC the database exposes, by name. */
export type RpcName = keyof Database["public"]["Functions"];

/**
 * Marks a required RPC parameter that nonetheless accepts NULL.
 *
 * The widening above reaches parameters with a SQL DEFAULT. A parameter
 * without one is typed non-null by the generator even when the function
 * handles null deliberately, and some cannot be given a default at all —
 * `inventory_grid(p_rate_plan_id uuid, p_from date, ...)` cannot, because a
 * parameter with a default may not be followed by one without.
 *
 * Casting the whole args object would drop the checking on every other field,
 * so this marks the one parameter instead. Each use should say at the call
 * site what null means to that function.
 */
export function nullableArg<T>(value: T | null): T {
  return value as T;
}
