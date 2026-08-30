export function secureRandomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error('invalid_random_range')
  const ceiling = Math.floor(0x100000000 / maxExclusive) * maxExclusive
  const values = new Uint32Array(1)
  do { crypto.getRandomValues(values) } while (values[0] >= ceiling)
  return values[0] % maxExclusive
}

export function secureCode(length, alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789') {
  let code = ''
  for (let index = 0; index < length; index += 1) code += alphabet[secureRandomInt(alphabet.length)]
  return code
}
