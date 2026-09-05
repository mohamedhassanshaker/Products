import { Type, type Schema } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { schemaToJsonSchema } from './schema-to-json-schema';

describe('schemaToJsonSchema', () => {
  it('maps every Gemini Type enum value to its lowercase JSON Schema equivalent', () => {
    expect(schemaToJsonSchema({ type: Type.STRING })).toEqual({ type: 'string' });
    expect(schemaToJsonSchema({ type: Type.NUMBER })).toEqual({ type: 'number' });
    expect(schemaToJsonSchema({ type: Type.INTEGER })).toEqual({ type: 'integer' });
    expect(schemaToJsonSchema({ type: Type.BOOLEAN })).toEqual({ type: 'boolean' });
    expect(schemaToJsonSchema({ type: Type.ARRAY })).toEqual({ type: 'array' });
    expect(schemaToJsonSchema({ type: Type.OBJECT })).toEqual({ type: 'object' });
    expect(schemaToJsonSchema({ type: Type.NULL })).toEqual({ type: 'null' });
  });

  it('omits `type` for TYPE_UNSPECIFIED rather than guessing', () => {
    expect(schemaToJsonSchema({ type: Type.TYPE_UNSPECIFIED })).toEqual({});
  });

  it('carries description/enum/format/nullable/min-max fields through unchanged', () => {
    const schema: Schema = {
      type: Type.STRING,
      description: 'A test field',
      enum: ['A', 'B'],
      format: 'enum',
      nullable: true,
    };
    expect(schemaToJsonSchema(schema)).toEqual({
      type: 'string',
      description: 'A test field',
      enum: ['A', 'B'],
      format: 'enum',
      nullable: true,
    });
  });

  it('converts numeric-string minItems/maxItems/minLength/maxLength to real numbers', () => {
    const schema: Schema = { type: Type.ARRAY, minItems: '4', maxItems: '5' };
    expect(schemaToJsonSchema(schema)).toEqual({ type: 'array', minItems: 4, maxItems: 5 });
  });

  it('recurses into object properties, preserving required', () => {
    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        key: { type: Type.STRING },
        count: { type: Type.INTEGER, minimum: 1, maximum: 6 },
      },
      required: ['key', 'count'],
    };
    expect(schemaToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        key: { type: 'string' },
        count: { type: 'integer', minimum: 1, maximum: 6 },
      },
      required: ['key', 'count'],
    });
  });

  it('recurses into array items', () => {
    const schema: Schema = { type: Type.ARRAY, items: { type: Type.STRING } };
    expect(schemaToJsonSchema(schema)).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('recurses into anyOf', () => {
    const schema: Schema = { anyOf: [{ type: Type.STRING }, { type: Type.NUMBER }] };
    expect(schemaToJsonSchema(schema)).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] });
  });

  it('recurses through a realistic nested schema (array of objects with a nested array field)', () => {
    const schema: Schema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          questionText: { type: Type.STRING },
          options: {
            type: Type.ARRAY,
            items: { type: Type.OBJECT, properties: { key: { type: Type.STRING }, text: { type: Type.STRING } }, required: ['key', 'text'] },
            minItems: '4',
            maxItems: '5',
          },
        },
        required: ['questionText', 'options'],
      },
    };
    const result = schemaToJsonSchema(schema);
    expect(result).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        required: ['questionText', 'options'],
        properties: {
          questionText: { type: 'string' },
          options: { type: 'array', minItems: 4, maxItems: 5 },
        },
      },
    });
  });
});
