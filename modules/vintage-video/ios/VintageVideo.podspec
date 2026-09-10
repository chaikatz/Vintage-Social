Pod::Spec.new do |s|
  s.name           = 'VintageVideo'
  s.version        = '1.0.0'
  s.summary        = 'Burns a VINTAGE film look into a video before it is posted.'
  s.description    = 'Local Expo module. Applies the same colour matrix, fade, vignette and grain the GL shader applies to photographs, frame by frame, with AVFoundation and Core Image.'
  s.author         = 'VINTAGE'
  s.homepage       = 'https://github.com/chaikatz/Vintage-Social'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
