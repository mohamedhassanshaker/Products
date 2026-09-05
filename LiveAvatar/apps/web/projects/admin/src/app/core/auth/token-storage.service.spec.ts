import { TokenStorageService } from './token-storage.service';

describe('TokenStorageService', () => {
  let service: TokenStorageService;

  beforeEach(() => {
    localStorage.clear();
    service = new TokenStorageService();
  });

  it('returns null when nothing is stored', () => {
    expect(service.getRefreshToken()).toBeNull();
  });

  it('stores and retrieves a refresh token', () => {
    service.setRefreshToken('rt-abc');
    expect(service.getRefreshToken()).toBe('rt-abc');
  });

  it('clears the stored token', () => {
    service.setRefreshToken('rt-abc');
    service.clear();
    expect(service.getRefreshToken()).toBeNull();
  });

  it('does not throw when localStorage access fails', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(service.getRefreshToken()).toBeNull();
    spy.mockRestore();
  });
});
