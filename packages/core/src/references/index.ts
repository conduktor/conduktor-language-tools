export { findReferences, referenceAt, type Reference } from './extract';
export { describeSources, NameIndex, type NameSource } from './nameIndex';
export {
  collides,
  matcher,
  overlapsOf,
  patternTraps,
  patternTypeOf,
  type Instance,
  type OwnedResource,
  type PatternReading,
  type PatternType,
} from './patterns';
export { referencingKinds, referrersOf, type Reach, type ReferenceTarget } from './reverse';
export { REFERENCE_RULES, type ReferenceRule } from './table';
export { instanceOf, referenceProblems, type NameLookup, type ReferenceProblem } from './problems';
