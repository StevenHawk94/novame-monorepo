import ExpoModulesCore

public class BurrowAdventureVideoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BurrowAdventureVideo")
    Constants(["loopingVersion": 1])
    View(BurrowAdventureVideoView.self) {
      Events("onFirstFrame", "onError")
      Prop("source") { (view: BurrowAdventureVideoView, source: String) in
        view.setSource(source)
      }
      Prop("active") { (view: BurrowAdventureVideoView, active: Bool) in
        view.setActive(active)
      }
    }
  }
}
