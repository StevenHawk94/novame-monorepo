// Keep descriptor refreshes out of AnimatedProps identity; otherwise finishing
// My Room's close can reset the outgoing Burrow transform to x=0 for one frame.
export { NativeAnimatedContent as AnimatedTabScene } from '../ui/native-animated-content';
