import ExpoModulesCore
import CoreHaptics
import os

public class TouchRuntimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TouchRuntime")
    AsyncFunction("capabilities") { () -> [String: Any] in
      // This is an advisory process budget, not a promise of allocation success.
      return ["availableBytes": Double(os_proc_available_memory()),
              "lowMemory": false,
              "hasVibrator": CHHapticEngine.capabilitiesForHardware().supportsHaptics,
              "systemHaptics": "unknown"]
    }
  }
}
