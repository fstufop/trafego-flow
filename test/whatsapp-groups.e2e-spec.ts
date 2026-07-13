import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DataSource } from 'typeorm';

describe('WhatsAppGroups (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let clientId: string;

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

    const clientRes = await request(app.getHttpServer())
      .post('/api/v1/clients')
      .set('x-api-key', API_KEY)
      .send({ name: 'Cliente WA Test', email: `wa-test-${Date.now()}@test.com` });

    clientId = clientRes.body.id;
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM whatsapp_groups');
    await dataSource.query(`DELETE FROM clients WHERE id = '${clientId}'`);
    await app.close();
  });

  describe('POST /api/v1/whatsapp-groups', () => {
    it('401 quando x-api-key está ausente', () => {
      return request(app.getHttpServer())
        .post('/api/v1/whatsapp-groups')
        .send({ clientId, groupJid: '120363000001@g.us' })
        .expect(401);
    });

    it('400 quando groupJid tem formato inválido', () => {
      return request(app.getHttpServer())
        .post('/api/v1/whatsapp-groups')
        .set('x-api-key', API_KEY)
        .send({ clientId, groupJid: 'grupo-invalido' })
        .expect(400);
    });

    it('400 quando clientId não é UUID', () => {
      return request(app.getHttpServer())
        .post('/api/v1/whatsapp-groups')
        .set('x-api-key', API_KEY)
        .send({ clientId: 'nao-e-uuid', groupJid: '120363000001@g.us' })
        .expect(400);
    });

    it('201 cria grupo e retorna entidade', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp-groups')
        .set('x-api-key', API_KEY)
        .send({ clientId, groupJid: '120363000001@g.us', label: 'Grupo Principal' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.groupJid).toBe('120363000001@g.us');
      expect(res.body.clientId).toBe(clientId);
      expect(res.body.isActive).toBe(true);
    });

    it('409 para groupJid duplicado', () => {
      return request(app.getHttpServer())
        .post('/api/v1/whatsapp-groups')
        .set('x-api-key', API_KEY)
        .send({ clientId, groupJid: '120363000001@g.us' })
        .expect(409);
    });
  });

  describe('GET /api/v1/whatsapp-groups', () => {
    it('200 retorna array de grupos ativos do cliente', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/whatsapp-groups')
        .query({ clientId })
        .set('x-api-key', API_KEY)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('400 quando clientId não é UUID válido', () => {
      return request(app.getHttpServer())
        .get('/api/v1/whatsapp-groups')
        .query({ clientId: 'abc' })
        .set('x-api-key', API_KEY)
        .expect(400);
    });
  });

  describe('PATCH /api/v1/whatsapp-groups/:id', () => {
    let groupId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp-groups')
        .set('x-api-key', API_KEY)
        .send({ clientId, groupJid: '120363000002@g.us', label: 'Grupo PATCH' });
      groupId = res.body.id;
    });

    it('200 atualiza label do grupo', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/whatsapp-groups/${groupId}`)
        .set('x-api-key', API_KEY)
        .send({ label: 'Novo Label' })
        .expect(200);

      expect(res.body.label).toBe('Novo Label');
    });
  });

  describe('DELETE /api/v1/whatsapp-groups/:id', () => {
    let groupId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp-groups')
        .set('x-api-key', API_KEY)
        .send({ clientId, groupJid: '120363000003@g.us', label: 'Grupo DELETE' });
      groupId = res.body.id;
    });

    it('204 remove o grupo (soft delete)', () => {
      return request(app.getHttpServer())
        .delete(`/api/v1/whatsapp-groups/${groupId}`)
        .set('x-api-key', API_KEY)
        .expect(204);
    });

    it('grupo removido não aparece na listagem', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/whatsapp-groups')
        .query({ clientId })
        .set('x-api-key', API_KEY)
        .expect(200);

      const found = res.body.find((g: { id: string }) => g.id === groupId);
      expect(found).toBeUndefined();
    });
  });
});
