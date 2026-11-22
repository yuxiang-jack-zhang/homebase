import MapView, { Circle, Marker } from 'react-native-maps';

/** Apple Maps pin plus a circle of the geofence radius. */
export function HomeMap({ lat, lng, radiusM, height = 280 }: { lat: number; lng: number; radiusM: number; height?: number }) {
  const delta = Math.max((radiusM * 6) / 111_000, 0.002); // ~3x the radius across, in degrees
  return (
    <MapView
      style={{ height, borderRadius: 12 }}
      region={{ latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta }}
      scrollEnabled={false}
      zoomEnabled={false}>
      <Marker coordinate={{ latitude: lat, longitude: lng }} />
      <Circle center={{ latitude: lat, longitude: lng }} radius={radiusM} strokeWidth={2} strokeColor="#007aff" fillColor="rgba(0,122,255,0.15)" />
    </MapView>
  );
}
