import { Effect, Ref } from "effect";
import { NotFound } from "./errors.js";

// In-memory platform state. Everything is lost on restart (ADR 0011). Records are immutable: every
// write replaces the whole record, so a reader never sees a half-applied change.

/**
 * One collection of records keyed by `K`. Every operation is atomic, so a check and the write that
 * depends on it cannot interleave with another fiber's.
 */
export type Table<K extends string, V> = {
  readonly get: (key: K) => Effect.Effect<V, NotFound>;
  readonly lookup: (key: K) => Effect.Effect<V | undefined>;
  readonly all: Effect.Effect<ReadonlyArray<V>>;
  readonly put: (value: V) => Effect.Effect<void>;
  /** Replace a record with `f`'s result and return the new record. */
  readonly update: (key: K, f: (value: V) => V) => Effect.Effect<V, NotFound>;
};

/** An empty table. `noun` names a missing record in NotFound. */
export function makeTable<K extends string, V>(noun: string, keyOf: (value: V) => K): Effect.Effect<Table<K, V>> {
  return Effect.map(Ref.make<ReadonlyMap<K, V>>(new Map()), (ref): Table<K, V> => {
    const notFound = (key: K) => new NotFound({ message: `no ${noun} ${key}` });
    return {
      get: (key) =>
        Effect.flatMap(Ref.get(ref), (map) => {
          const value = map.get(key);
          return value === undefined ? Effect.fail(notFound(key)) : Effect.succeed(value);
        }),
      lookup: (key) => Effect.map(Ref.get(ref), (map) => map.get(key)),
      all: Effect.map(Ref.get(ref), (map) => [...map.values()]),
      put: (value) => Ref.update(ref, (map) => withEntry(map, keyOf(value), value)),
      update: (key, f) =>
        Effect.flatten(
          Ref.modify(ref, (map): readonly [Effect.Effect<V, NotFound>, ReadonlyMap<K, V>] => {
            const value = map.get(key);
            if (value === undefined) return [Effect.fail(notFound(key)), map];
            const next = f(value);
            return [Effect.succeed(next), withEntry(map, key, next)];
          }),
        ),
    };
  });
}

/** A copy of `map` with `key` set to `value`, or without `key` when `value` is undefined. */
export function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V | undefined): ReadonlyMap<K, V> {
  const next = new Map(map);
  if (value === undefined) next.delete(key);
  else next.set(key, value);
  return next;
}
