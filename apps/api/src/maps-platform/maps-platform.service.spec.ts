import axios from 'axios';
import { MapsPlatformService } from './maps-platform.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function service() {
  const config = {
    get: (key: string) =>
      key === 'MAPS_PLATFORM_URL' ? 'http://maps:8080' : undefined,
  };
  mockedAxios.post.mockResolvedValue({ data: {} });
  return new MapsPlatformService(config as never);
}

const booked = { lat: 0.3136, lng: 32.5811 };

describe('MapsPlatformService.learnPlace', () => {
  afterEach(() => jest.clearAllMocks());

  it("records the place at the rider's own position, not the booked pin", () => {
    const maps = service();
    const rider = { lat: 0.3139, lng: 32.5813 }; // ~40 m away
    maps.notePosition('trip:t1', rider, new Date());

    maps.learnPlace('trip:t1', 'Acacia Mall', booked);

    const [url, body] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('http://maps:8080/v1/places');
    expect(body).toEqual({
      source: 'pikidada',
      places: [{ label: 'Acacia Mall', ...rider }],
    });
  });

  it('ignores a rider far from the pin, or a stale position', () => {
    const maps = service();
    maps.notePosition('trip:far', { lat: 0.35, lng: 32.6 }, new Date());
    maps.notePosition(
      'trip:stale',
      booked,
      new Date(Date.now() - 10 * 60 * 1000),
    );

    maps.learnPlace('trip:far', 'Acacia Mall', booked);
    maps.learnPlace('trip:stale', 'Acacia Mall', booked);
    maps.learnPlace('trip:unknown', 'Acacia Mall', booked);

    expect(mockedAxios.post.mock.calls).toHaveLength(0);
  });
});
