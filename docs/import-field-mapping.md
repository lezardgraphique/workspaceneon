## Import field mapping

`src/lib/field-mapping.ts` contains the shared normalization and matching primitives for foreign CMS fields: it resolves nested paths and HuBL `{% set %}` aliases while preserving the original field hierarchy and names. When updating import flows, use these helpers for field/value matching rather than flattening or renaming the imported schema.
