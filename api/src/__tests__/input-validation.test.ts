import { describe, it, expect } from 'vitest';
import {
  validateOutcomeInput,
  validateMotivationInput,
  validateMilestoneInput,
  validateTagInput,
  validateUUIDParam,
  isValidUUID,
} from '../lib/input-validation.js';

describe('validateOutcomeInput', () => {
  it('passes with valid input', () => {
    expect(validateOutcomeInput({ title: 'Test', status: 'active', effort: 'M' })).toBeNull();
  });

  it('requires title', () => {
    expect(validateOutcomeInput({})).toBe('title is required');
    expect(validateOutcomeInput({ title: '' })).toBe('title is required');
    expect(validateOutcomeInput({ title: 123 })).toBe('title is required');
  });

  it('rejects long title', () => {
    expect(validateOutcomeInput({ title: 'x'.repeat(501) })).toBe('title must be under 500 characters');
  });

  it('rejects invalid effort', () => {
    expect(validateOutcomeInput({ title: 'Test', effort: 'HUGE' })).toContain('effort must be one of');
  });

  it('rejects invalid status', () => {
    expect(validateOutcomeInput({ title: 'Test', status: 'invalid' })).toContain('status must be one of');
  });

  it('rejects invalid milestoneId', () => {
    expect(validateOutcomeInput({ title: 'Test', milestoneId: 'not-a-uuid' })).toBe('milestoneId must be a valid UUID');
  });

  it('rejects invalid tagIds', () => {
    expect(validateOutcomeInput({ title: 'Test', tagIds: ['not-uuid'] })).toBe('tagIds must be an array of UUIDs');
    expect(validateOutcomeInput({ title: 'Test', tagIds: 'string' })).toBe('tagIds must be an array of UUIDs');
  });

  it('accepts valid tagIds', () => {
    expect(validateOutcomeInput({ title: 'Test', tagIds: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'] })).toBeNull();
  });
});

describe('validateMotivationInput', () => {
  const validTypeId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  it('passes with valid input', () => {
    expect(validateMotivationInput({ title: 'Test', typeId: validTypeId })).toBeNull();
  });

  it('requires title', () => {
    expect(validateMotivationInput({ typeId: validTypeId })).toBe('title is required');
  });

  it('requires typeId', () => {
    expect(validateMotivationInput({ title: 'Test' })).toBe('typeId is required');
  });

  it('rejects invalid typeId', () => {
    expect(validateMotivationInput({ title: 'Test', typeId: 'bad' })).toBe('typeId must be a valid UUID');
  });
});

describe('validateMilestoneInput', () => {
  it('passes with valid input', () => {
    expect(validateMilestoneInput({ name: 'Q3', targetDate: '2026-09-30' })).toBeNull();
  });

  it('requires name', () => {
    expect(validateMilestoneInput({ targetDate: '2026-09-30' })).toBe('name is required');
  });

  it('requires targetDate', () => {
    expect(validateMilestoneInput({ name: 'Q3' })).toBe('targetDate is required');
  });

  it('rejects invalid date format', () => {
    expect(validateMilestoneInput({ name: 'Q3', targetDate: 'September' })).toBe('targetDate must be YYYY-MM-DD format');
  });

  it('rejects invalid type', () => {
    expect(validateMilestoneInput({ name: 'Q3', targetDate: '2026-09-30', type: 'sprint' })).toContain('type must be one of');
  });
});

describe('validateTagInput', () => {
  it('passes with valid input', () => {
    expect(validateTagInput({ name: 'security' })).toBeNull();
  });

  it('requires name', () => {
    expect(validateTagInput({})).toBe('name is required');
  });

  it('rejects long name', () => {
    expect(validateTagInput({ name: 'x'.repeat(101) })).toBe('name must be under 100 characters');
  });

  it('rejects invalid colour', () => {
    expect(validateTagInput({ name: 'test', colour: 'red' })).toBe('colour must be #RRGGBB format');
    expect(validateTagInput({ name: 'test', colour: '#fff' })).toBe('colour must be #RRGGBB format');
  });

  it('accepts valid colour', () => {
    expect(validateTagInput({ name: 'test', colour: '#c43c3c' })).toBeNull();
  });
});

describe('isValidUUID', () => {
  it('accepts valid UUIDs', () => {
    expect(isValidUUID('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
  });

  it('rejects invalid UUIDs', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('')).toBe(false);
    expect(isValidUUID(123)).toBe(false);
    expect(isValidUUID(null)).toBe(false);
  });
});

describe('validateUUIDParam', () => {
  it('passes valid UUID', () => {
    expect(validateUUIDParam('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBeNull();
  });

  it('rejects invalid', () => {
    expect(validateUUIDParam('bad')).toBe('Invalid ID format');
  });
});
