import _Ajv2020 from 'ajv/dist/2020.js';
import _addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';

// Handle CJS/ESM interop
const Ajv2020 = (_Ajv2020 as any).default ?? _Ajv2020;
const addFormats = (_addFormats as any).default ?? _addFormats;
import { db } from '../db/index.js';
import { motivationTypes } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);

// Cache compiled validators by type ID
const validatorCache = new Map<string, ReturnType<typeof ajv.compile>>();

interface FieldError {
  field: string;
  message: string;
}

interface ValidationResult {
  valid: boolean;
  errors?: FieldError[];
}

function extractFieldErrors(errors: ErrorObject[] | null | undefined): FieldError[] {
  if (!errors) return [];
  return errors.map((err) => {
    let field: string;
    if (err.keyword === 'required') {
      field = err.params.missingProperty as string;
    } else if (err.keyword === 'additionalProperties') {
      field = err.params.additionalProperty as string;
    } else {
      field = err.instancePath.slice(1).replace(/\//g, '.');
    }
    return { field, message: err.message ?? 'validation failed' };
  });
}

export async function validateAttributes(typeId: string, attributes: Record<string, unknown>): Promise<ValidationResult> {
  let validate = validatorCache.get(typeId);

  if (!validate) {
    const [mt] = await db.select().from(motivationTypes).where(eq(motivationTypes.id, typeId)).limit(1);
    if (!mt) {
      return { valid: false, errors: [{ field: 'type_id', message: 'Unknown motivation type' }] };
    }
    validate = ajv.compile(mt.attributeSchema);
    validatorCache.set(typeId, validate);
  }

  const valid = validate(attributes);
  if (valid) {
    return { valid: true };
  }

  return { valid: false, errors: extractFieldErrors(validate.errors) };
}