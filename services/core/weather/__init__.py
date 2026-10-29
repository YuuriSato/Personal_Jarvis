import httpx

WMO = {0: 'Céu limpo', 1: 'Predominantemente limpo', 2: 'Parcialmente nublado', 3: 'Nublado',
       45: 'Neblina', 48: 'Nevoeiro', 51: 'Garoa leve', 53: 'Garoa', 55: 'Garoa intensa',
       61: 'Chuva leve', 63: 'Chuva', 65: 'Chuva forte', 80: 'Pancadas leves',
       81: 'Pancadas de chuva', 82: 'Pancadas fortes', 95: 'Trovoadas', 96: 'Trovoadas com granizo', 99: 'Granizo forte'}


async def search_city(query, transport=None):
    if not 2 <= len(query.strip()) <= 120:
        raise ValueError('Informe uma cidade com pelo menos dois caracteres.')
    async with httpx.AsyncClient(timeout=10, trust_env=False, follow_redirects=False, transport=transport) as client:
        response = await client.get('https://geocoding-api.open-meteo.com/v1/search', params={'name': query.strip(), 'language': 'pt', 'count': 8})
        response.raise_for_status()
        rows = response.json().get('results', [])
    return [{'name': r['name'], 'region': r.get('admin1', ''), 'country': r.get('country', ''),
             'latitude': r['latitude'], 'longitude': r['longitude'], 'timezone': r.get('timezone', '')} for r in rows]
