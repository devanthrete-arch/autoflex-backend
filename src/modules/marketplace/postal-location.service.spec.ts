import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PostalLocationService } from './postal-location.service';

describe('Postal directory lookup', () => {
  let service: PostalLocationService;
  let fetchMock: jest.SpyInstance;
  const office = {
    Name: ' MG Road ',
    District: 'Bangalore',
    State: 'Karnataka',
    Pincode: '560001',
    Country: 'India',
  };
  const success = () =>
    new Response(
      JSON.stringify([
        {
          Status: 'Success',
          PostOffice: [office, office, { ...office, Pincode: '560002' }],
        },
      ]),
    );
  beforeEach(() => {
    service = new PostalLocationService();
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('validates the PIN before requesting a fixed provider URL', async () => {
    await expect(service.lookup('056001')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.lookup('560001/other')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('normalizes and deduplicates matching India postal areas without inventing coordinates', async () => {
    fetchMock.mockResolvedValue(success());
    expect(await service.lookup('560001')).toEqual({
      postalCode: '560001',
      source: 'postalpincode.in',
      areas: [
        { locality: 'MG Road', district: 'Bangalore', state: 'Karnataka' },
      ],
    });
    await service.lookup('560001');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.postalpincode.in/pincode/560001',
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it('shares an in-flight request for the same PIN', async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const first = service.lookup('560001'),
      second = service.lookup('560001');
    finish(success());
    expect(await first).toEqual(await second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('returns a distinct not-found result and caches it briefly', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ Status: 'Error', PostOffice: null }])),
    );
    await expect(service.lookup('999999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.lookup('999999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(['network', 'http', 'malformed', 'mismatched'])(
    'reports %s failure without caching a false location',
    async (failure) => {
      if (failure === 'network')
        fetchMock.mockRejectedValueOnce(new Error('timeout'));
      else if (failure === 'http')
        fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
      else if (failure === 'malformed')
        fetchMock.mockResolvedValueOnce(new Response('not-json'));
      else
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                Status: 'Success',
                PostOffice: [{ ...office, Pincode: '560002' }],
              },
            ]),
          ),
        );
      await expect(service.lookup('560001')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      fetchMock.mockResolvedValueOnce(success());
      expect((await service.lookup('560001')).postalCode).toBe('560001');
    },
  );
});
