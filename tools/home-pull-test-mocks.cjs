// Scene tests isolate native gesture plumbing; its actual lifecycle is tested
// separately in test-home-pull-preview.cjs.
const guard=action=>action;
module.exports={
  '@/lib/use-home-pull-preview':{useHomePullPreview:()=>({gesture:{},animatedStyle:{},guard})},
  'react-native-gesture-handler':{GestureDetector:'GestureDetector'},
  'react-native-reanimated':{__esModule:true,default:{View:'AnimatedView'}},
};
