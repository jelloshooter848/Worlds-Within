/**
 * English plurals for counted text (Engine 0.16 P8): `plural('raider')` is `raiders`,
 * `countText(2, 'soldier')` is `2 soldiers`. Pure and presentation only: never in a world, a hash
 * or save code.
 *
 *   plural('army')   // 'armies'
 *   plural('torch')  // 'torches'
 *   countText(1, 'ram') // 'ram'
 */

/** A word's English plural: consonant + y -> ies, s/x/ch/sh -> es, else + s. */
export function plural(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/** `n word` with the plural when `n` is not 1, and the bare word for one: `ram`, `2 rams`. */
export function countText(n: number, word: string, pluralWord: string = plural(word)): string {
  return n === 1 ? word : `${n} ${pluralWord}`;
}
