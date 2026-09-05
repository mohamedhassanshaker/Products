import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { SkillsApiService } from './skills-api.service';

describe('SkillsApiService', () => {
  let service: SkillsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(SkillsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /api/tenants/{id}/skills', () => {
    service.list('t-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/skills');
    expect(req.request.method).toBe('GET');
    req.flush({ items: [] });
  });

  it('GETs /api/tenants/{id}/skills/{skillId}', () => {
    service.get('t-1', 'skill-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/skills/skill-1');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('GETs /api/tenants/{id}/skills/{skillId}/usage', () => {
    service.usage('t-1', 'skill-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/skills/skill-1/usage');
    expect(req.request.method).toBe('GET');
    req.flush({ used_by_agent_count: 0 });
  });

  it('POSTs /api/tenants/{id}/skills', () => {
    const body = { name: 'Refunds' };
    service.create('t-1', body).subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/skills');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({});
  });

  it('PATCHes /api/tenants/{id}/skills/{skillId}/draft', () => {
    service.updateDraft('t-1', 'skill-1', { description: 'Handle refunds' }).subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/skills/skill-1/draft');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ description: 'Handle refunds' });
    req.flush({});
  });

  it('POSTs /api/tenants/{id}/skills/{skillId}/publish', () => {
    service.publish('t-1', 'skill-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/skills/skill-1/publish');
    expect(req.request.method).toBe('POST');
    req.flush({ skill: {} });
  });

  it('DELETEs /api/tenants/{id}/skills/{skillId}', () => {
    service.delete('t-1', 'skill-1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t-1/skills/skill-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
