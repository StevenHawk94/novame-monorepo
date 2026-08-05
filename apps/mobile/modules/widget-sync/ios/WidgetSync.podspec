Pod::Spec.new do |s|
  s.name           = 'WidgetSync'
  s.version        = '1.0.0'
  s.summary        = 'Shares the latest friend reflect with the NovaMe home-screen widget'
  s.description    = 'Copies item images + payload JSON into the App Group container and reloads WidgetKit timelines.'
  s.author         = 'NovaMe'
  s.homepage       = 'https://novame.app'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end
