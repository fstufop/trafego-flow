import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DataSource } from 'typeorm';

describe('Clients (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const API_KEY = process.env.MASTER_API_KEY ?? 'change-me-in-production';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM clients');
    await app.close();
  });

  describe('POST /api/v1/clients', () => {
    it('401 when x-api-key is missing', () => {
      return request(app.getHttpServer()).post('/api/v1/clients').send({ name: 'A', email: 'a@b.com' }).expect(401);
    });

    it('400 when body is invalid', () => {
      return request(app.getHttpServer())
        .post('/api/v1/clients')
        .set('x-api-key', API_KEY)
        .send({ name: '', email: 'not-an-email' })
        .expect(400);
    });

    it('201 creates client and returns id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/clients')
        .set('x-api-key', API_KEY)
        .send({ name: 'Agência XYZ', email: 'contato@xyz.com' })
        .expect(201);

      expect(res.body).toMatchObject({ name: 'Agência XYZ', email: 'contato@xyz.com', isActive: true });
      expect(res.body.id).toBeDefined();
    });

    it('409 on duplicate email', () => {
      return request(app.getHttpServer())
        .post('/api/v1/clients')
        .set('x-api-key', API_KEY)
        .send({ name: 'Outro', email: 'contato@xyz.com' })
        .expect(409);
    });
  });

  describe('GET /api/v1/clients', () => {
    it('200 returns array of active clients', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clients').set('x-api-key', API_KEY).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/clients/:id', () => {
    let createdId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/clients')
        .set('x-api-key', API_KEY)
        .send({ name: 'Cliente GET', email: 'get@test.com' });
      createdId = res.body.id;
    });

    it('200 returns client by id', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/clients/${createdId}`)
        .set('x-api-key', API_KEY)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(createdId);
        });
    });

    it('404 for nonexistent id', () => {
      return request(app.getHttpServer())
        .get('/api/v1/clients/00000000-0000-0000-0000-000000000000')
        .set('x-api-key', API_KEY)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/clients/:id', () => {
    let createdId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/clients')
        .set('x-api-key', API_KEY)
        .send({ name: 'Cliente PATCH', email: 'patch@test.com' });
      createdId = res.body.id;
    });

    it('200 updates and returns updated client', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/clients/${createdId}`)
        .set('x-api-key', API_KEY)
        .send({ name: 'Nome Atualizado' })
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBe('Nome Atualizado');
        });
    });
  });

  describe('DELETE /api/v1/clients/:id', () => {
    let createdId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/clients')
        .set('x-api-key', API_KEY)
        .send({ name: 'Cliente DELETE', email: 'delete@test.com' });
      createdId = res.body.id;
    });

    it('204 soft deletes client', () => {
      return request(app.getHttpServer())
        .delete(`/api/v1/clients/${createdId}`)
        .set('x-api-key', API_KEY)
        .expect(204);
    });

    it('deleted client does not appear in list', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clients').set('x-api-key', API_KEY).expect(200);

      const found = res.body.find((c: { id: string }) => c.id === createdId);
      expect(found).toBeUndefined();
    });
  });
});
