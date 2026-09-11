require 'minitest/autorun'
require 'tmpdir'
require_relative '../src/stultus/render_assets'

class RenderAssetsTest < Minitest::Test
  PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1kAAAAASUVORK5CYII='
  ID = '9a629853-81b2-4d38-84b8-508deba24932'
  def setup
    @dir = Dir.mktmpdir('stultus-assets-test-')
    @assets = BACommunity::Stultus::RenderAssets
    @original_root = @assets.method(:root)
    dir = @dir
    @assets.define_singleton_method(:root) { dir }
  end
  def teardown
    @assets.define_singleton_method(:root, @original_root)
    FileUtils.remove_entry(@dir)
  end
  def test_roundtrip
    assert @assets.store(ID, PNG, PNG)[:ok]
    assert_equal PNG, @assets.read(ID)[:image]
    assert_equal PNG, @assets.read(ID)[:source]
  end
  def test_missing_file_is_explained
    refute @assets.read(ID)[:ok]
  end
  def test_traversal_is_rejected
    assert_raises(RuntimeError) { @assets.paths('../outside') }
    assert_raises(RuntimeError) { @assets.paths('C:/outside') }
  end
  def test_invalid_image_does_not_write
    assert_raises(RuntimeError) { @assets.store(ID, Base64.strict_encode64('not png'), PNG) }
    assert_empty Dir.children(@dir)
  end
end
