Pod::Spec.new do |s|
  s.name = 'BurrowAdventureVideo'
  s.version = '1.0.0'
  s.summary = 'Native queue looping for the Burrow Adventure video'
  s.description = 'A single AVPlayerLayer backed by AVQueuePlayer and AVPlayerLooper.'
  s.author = 'Burrow'
  s.homepage = 'https://novame.app'
  s.license = { :type => 'MIT' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.frameworks = 'AVFoundation', 'UIKit'
end
