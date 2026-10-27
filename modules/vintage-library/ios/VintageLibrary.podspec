Pod::Spec.new do |s|
  s.name           = 'VintageLibrary'
  s.version        = '1.0.0'
  s.summary        = 'Develops one photograph from the library for the editor.'
  s.description    = 'Local Expo module. Asks Photos for a rendition of the current version of a photograph, 2048 px on the long side, from the phone first and from iCloud only when asked, and writes it upright as a JPEG that carries none of the original file\'s metadata.'
  s.author         = 'VINTAGE'
  s.homepage       = 'https://github.com/chaikatz/Vintage-Social'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'Photos', 'ImageIO', 'UniformTypeIdentifiers'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
