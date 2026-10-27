import { BurrowScreen } from '@/components/burrow/burrow-screen';

/** Preserve old Collection links without mounting the retired inventory. */
export default function CollectionScreen() {
  return <BurrowScreen section="collection" asTab />;
}
