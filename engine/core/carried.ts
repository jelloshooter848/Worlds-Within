import { z } from 'zod';

/**
 * The carried record and the carry spec as plain JSON data (Engine 0.13 T5-T6; docs/BUILD-LOG.md,
 * Engine 0.13, decisions 5-7, items 224-226). Defined here, in the pure core, so `engine/sim`
 * (which builds and applies a record: `engine/sim/carry.ts`) and the campaign save and its save
 * code (`campaign.ts`, `campaign-code.ts`) share one schema without the core importing the sim.
 * `engine/sim` re-exports every name here.
 */

/** A carried person's fate as read: `active`, or a `Fate` state (`engine/sim/fate.ts`'s `FATE_STATES`). */
export const CARRIED_FATES = ['active', 'injured', 'captured', 'freed', 'dead'] as const;
export type CarriedFate = (typeof CARRIED_FATES)[number];

/** The `format` every carried record carries. */
export const CARRIED_FORMAT = 'worlds-within/carried';
/** The carried record version this engine reads. */
export const CARRIED_VERSION = 1;

const Key = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
const Tick = z.int().min(0);
const Count = z.int().min(0);

/** What carries from the first scenario's end world: named people by key and stockpile items. */
export const carrySpecSchema = z.strictObject({
  people: z
    .array(Key)
    .default([])
    .describe(
      'the keys of named people (squad members) whose `Health` and fate carry; keys of both scenarios',
    ),
  stockpiles: z
    .array(
      z.strictObject({
        faction: Key.describe("the faction whose stockpile's items carry"),
        items: z.array(Key).min(1).describe("the items whose counts carry (replacing the second scenario's)"),
      }),
    )
    .default([])
    .describe('stockpile items by faction; the faction needs a `Stockpile` in both worlds'),
});

/** A scenario's `from`: the scenario it follows, what carries, and what a carried fate opens. */
export const carryFromSchema = z.strictObject({
  scenario: Key.describe("the first scenario's content id (the carried record's `from` must match)"),
  carry: carrySpecSchema.describe('what carries (Engine 0.13)'),
  when: z
    .array(
      z.strictObject({
        key: Key.describe('a key of `carry.people`'),
        fate: z.enum(CARRIED_FATES).describe('the carried fate that triggers the rule'),
        open: z
          .array(Key)
          .min(1)
          .describe('dormant `relative` opportunities of this scenario to open at tick 0, in this order'),
      }),
    )
    .default([])
    .describe('rules applied in order after the carried data: opportunities a carried fate opens'),
});
export type CarryFrom = z.infer<typeof carryFromSchema>;

/** One carried person: their fate as read in the first world and their `Health` (null without one). */
const carriedPersonSchema = z
  .strictObject({
    fate: z.enum(CARRIED_FATES).describe('`active` or a `Fate` state'),
    by: Key.nullable().describe('who captured or killed them (null while active or not known)'),
    at: Tick.nullable().describe('the first world tick the state was reached (null while active)'),
    hp: Count.nullable().describe("`Health.hp` at the first world's end (null: no `Health`)"),
    max: z.int().min(1).nullable().describe('`Health.max` (null exactly when `hp` is)'),
  })
  .superRefine((p, ctx) => {
    if (p.fate === 'active' && (p.by !== null || p.at !== null))
      ctx.addIssue({ code: 'custom', path: ['fate'], message: 'an active person has no `by` or `at`' });
    if (p.fate !== 'active' && p.at === null)
      ctx.addIssue({
        code: 'custom',
        path: ['at'],
        message: `a ${p.fate} person needs the tick it was reached`,
      });
    if ((p.hp === null) !== (p.max === null))
      ctx.addIssue({ code: 'custom', path: ['max'], message: 'give both `hp` and `max`, or neither' });
    if (p.hp !== null && p.max !== null && p.hp > p.max)
      ctx.addIssue({ code: 'custom', path: ['hp'], message: `is more than max ${p.max}` });
    if (p.fate === 'dead' && p.hp !== null && p.hp > 0)
      ctx.addIssue({ code: 'custom', path: ['hp'], message: 'a dead person has 0 hp' });
  });
export type CarriedPerson = z.infer<typeof carriedPersonSchema>;

/** The carried record: plain JSON built by `carriedRecord`, read by `worldFromScenario`'s `carried`. */
export const carriedRecordSchema = z.strictObject({
  format: z.literal(CARRIED_FORMAT).describe('always `worlds-within/carried`'),
  version: z.literal(CARRIED_VERSION).describe('the carried record version'),
  from: Key.describe("the first scenario's content id (the second scenario's `from.scenario`)"),
  tick: Tick.describe('the first world tick the record was taken at'),
  people: z
    .record(Key, carriedPersonSchema)
    .describe("one entry per key of the carry spec's `people`, sorted by key"),
  stockpiles: z
    .record(Key, z.record(Key, Count))
    .describe("item counts by faction, then item, for the carry spec's `stockpiles`, sorted"),
});
export type CarriedRecord = z.infer<typeof carriedRecordSchema>;
