// Test setup file
import { closeDatabase } from '../src/services/database';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';

// Mock console.error to reduce noise in tests
const originalError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});

afterAll(() => {
  console.error = originalError;
  closeDatabase();
});

// Global test timeout
jest.setTimeout(10000);
