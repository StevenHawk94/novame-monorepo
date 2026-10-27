import { Redirect } from 'expo-router';

/** Legacy keyword-based creation is retired; existing memories remain readable. */
export default function SharedMemoryCreate() {
  return <Redirect href={{ pathname: '/(main)/burrow-detail', params: { section: 'memories_room' } }} />;
}
