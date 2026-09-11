Pod::Spec.new do |s|
  s.name           = 'TikTokEvents'
  s.version        = '1.0.0'
  s.summary        = 'Expo bridge for the official TikTok App Events SDK'
  s.description    = 'Privacy-gated TikTok App Events integration for Burrow.'
  s.author         = 'Burrow'
  s.homepage       = 'https://www.burrow-app.com'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'TikTokBusinessSDK', '1.7.1'
  s.source_files = '**/*.{h,m,swift}'
  s.libraries = 'c++'
  s.user_target_xcconfig = {
    'OTHER_LDFLAGS' => '$(inherited) -ObjC -lc++'
  }
end
