// Props for a field that holds a code rather than words.
//
// A catalogue number is the single most reliable search key on a record, and
// it is exactly the shape a phone keyboard likes to "help" with: PM-012 becomes
// PM-012's or Pm-012, RACCIDENT 004 becomes Accident 004, WAP63 gets a red
// squiggle and then a substitution on the space bar. The user is copying
// characters off a label, so every one of those is a wrong search and a
// pressing that cannot be found.
//
// spread onto the input rather than written out per field, because the failure
// of a field that misses one of these attributes is silent: it looks correct
// on a desktop browser, which does none of this, and only mangles what people
// type on the phones most of them are using.
//
// autoCapitalize is 'characters' rather than 'off' on purpose: catalogue
// numbers are printed uppercase, Discogs matches them case-insensitively, and
// the caps keyboard is the one that suits typing a code.
export const CODE_INPUT_PROPS = {
  autoCorrect: 'off',
  autoCapitalize: 'characters',
  autoComplete: 'off',
  spellCheck: false,
};
