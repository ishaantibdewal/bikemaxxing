// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

const bikeLanePaint = {
  'line-color': '#32D400',
  'line-width': 5,
  'line-opacity': 0.6,
};

const basemapStyle = {
  version: 8,
  sources: {
    'carto-light': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
  },
  layers: [
    {
      id: 'carto-light',
      type: 'raster',
      source: 'carto-light',
    },
  ],
};

const bluebikesStationUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const bluebikesTrafficUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
let timeFilter = -1;
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: basemapStyle,
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const svg = d3.select('#map').select('svg');
const tooltip = d3.select('body').append('div').attr('class', 'station-tooltip');

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function getTooltipText(station) {
  const name = station.name ?? station.NAME ?? station.short_name;
  return `${name}
${station.totalTraffic} trips
${station.departures} departures
${station.arrivals} arrivals`;
}

function positionTooltip(event) {
  tooltip
    .style('left', `${event.clientX + 12}px`)
    .style('top', `${event.clientY + 12}px`);
}

function getDepartureRatio(station) {
  return station.totalTraffic === 0
    ? 0.5
    : stationFlow(station.departures / station.totalTraffic);
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  const minMinute = (minute - 60 + 1440) % 1440;
  const maxMinute = (minute + 61) % 1440;

  if (minMinute > maxMinute) {
    const beforeMidnight = tripsByMinute.slice(minMinute);
    const afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  }

  return tripsByMinute.slice(minMinute, maxMinute).flat();
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLanePaint,
  });

  try {
    const jsonData = await d3.json(bluebikesStationUrl);
    await d3.csv(bluebikesTrafficUrl, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      const startedMinutes = minutesSinceMidnight(trip.started_at);
      departuresByMinute[startedMinutes].push(trip);

      const endedMinutes = minutesSinceMidnight(trip.ended_at);
      arrivalsByMinute[endedMinutes].push(trip);

      return trip;
    });

    console.log('Loaded JSON Data:', jsonData);

    const stations = computeStationTraffic(jsonData.data.stations);
    console.log('Stations Array:', stations);

    console.log('Stations with traffic:', stations);

    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    const circles = svg
      .selectAll('circle')
      .data(stations, (d) => d.short_name)
      .enter()
      .append('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) => getDepartureRatio(d))
      .on('pointerenter', (event, d) => {
        tooltip.style('display', 'block').text(getTooltipText(d));
        positionTooltip(event);
      })
      .on('pointermove', (event) => {
        positionTooltip(event);
      })
      .on('pointerleave', () => {
        tooltip.style('display', 'none');
      })
      .each(function (d) {
        d3.select(this)
          .append('title')
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
          );
      });

    function updatePositions() {
      circles
        .attr('cx', (d) => getCoords(d).cx)
        .attr('cy', (d) => getCoords(d).cy);
    }

    updatePositions();

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    function updateScatterPlot(timeFilter) {
      const filteredStations = computeStationTraffic(stations, timeFilter);

      timeFilter === -1
        ? radiusScale.range([0, 25])
        : radiusScale.range([3, 50]);

      circles
        .data(filteredStations, (d) => d.short_name)
        .join('circle')
        .attr('r', (d) => radiusScale(d.totalTraffic))
        .style('--departure-ratio', (d) => getDepartureRatio(d))
        .each(function (d) {
          if (tooltip.style('display') === 'block' && this.matches(':hover')) {
            tooltip.text(getTooltipText(d));
          }
        })
        .select('title')
        .text(
          (d) =>
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    }

    function updateTimeDisplay() {
      timeFilter = Number(timeSlider.value);

      if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
      }

      updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();
  } catch (error) {
    console.error('Error loading JSON:', error);
  }
});
