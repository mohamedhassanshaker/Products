import { Type } from '@sinclair/typebox';
import { AppError } from '../errors/app-error';
import { TypeBoxValidationPipe } from './typebox-pipe';

const Schema = Type.Object({
  name: Type.String({ minLength: 1 }),
  age: Type.Integer({ minimum: 0, default: 0 }),
});

describe('TypeBoxValidationPipe', () => {
  it('decodes a valid value, applying defaults', () => {
    const pipe = new TypeBoxValidationPipe(Schema, 'TENANT_NAME_INVALID');
    expect(pipe.transform({ name: 'Acme' })).toEqual({ name: 'Acme', age: 0 });
  });

  it('throws with the default code and field map when validation fails', () => {
    const pipe = new TypeBoxValidationPipe(Schema, 'TENANT_NAME_INVALID');
    try {
      pipe.transform({ name: '' });
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('TENANT_NAME_INVALID');
      expect((err as AppError).details.fields).toHaveProperty('name');
    }
  });

  it('treats a missing body as an empty object', () => {
    const pipe = new TypeBoxValidationPipe(Type.Object({}), 'TENANT_NAME_INVALID');
    expect(pipe.transform(undefined)).toEqual({});
  });

  it('coerces convertible types (string integer to number)', () => {
    const pipe = new TypeBoxValidationPipe(Schema, 'TENANT_NAME_INVALID');
    expect(pipe.transform({ name: 'x', age: '5' })).toEqual({ name: 'x', age: 5 });
  });
});
