Pod::Spec.new do |s|
  s.name = 'TouchRuntime'
  s.version = '1.0.0'
  s.summary = 'Local Touch Note memory and haptic capability checks'
  s.description = s.summary
  s.author = 'Burrow'
  s.homepage = 'https://novame.app'
  s.license = { :type => 'MIT' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreHaptics'
  s.source_files = '**/*.swift'
end
