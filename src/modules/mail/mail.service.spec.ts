import { of, throwError } from 'rxjs';
import { MailService } from './mail.service.js';

describe('MailService', () => {
  it('posts the message to the Mailgun API with basic auth and form-encoded body', async () => {
    const httpService = {
      post: jest.fn().mockReturnValue(of({ data: { id: 'ok' } })),
    };
    const config = {
      get: jest.fn(
        (k: string) =>
          ({
            'mailgun.apiKey': 'key-123',
            'mailgun.domain': 'mg.example.com',
            'mailgun.from': 'no-reply@example.com',
          })[k],
      ),
    };
    const service = new MailService(httpService as any, config as any);

    await service.send({
      to: 'client@example.com',
      subject: 'Assunto',
      html: '<p>Oi</p>',
    });

    expect(httpService.post).toHaveBeenCalledWith(
      'https://api.mailgun.net/v3/mg.example.com/messages',
      expect.any(URLSearchParams),
      expect.objectContaining({
        auth: { username: 'api', password: 'key-123' },
      }),
    );
  });

  it('propagates an error when Mailgun responds with failure', async () => {
    const httpService = {
      post: jest
        .fn()
        .mockReturnValue(throwError(() => new Error('mailgun down'))),
    };
    const config = { get: jest.fn().mockReturnValue('x') };
    const service = new MailService(httpService as any, config as any);

    await expect(
      service.send({ to: 'a@b.com', subject: 's', html: 'h' }),
    ).rejects.toThrow('mailgun down');
  });
});
