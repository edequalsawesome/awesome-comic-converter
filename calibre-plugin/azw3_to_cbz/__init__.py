from calibre.customize import InterfaceActionBase


class Azw3ToCbzPlugin(InterfaceActionBase):
    name = 'AZW3→CBZ (Comics)'
    description = 'Bulk-convert selected AZW3 to CBZ with ComicInfo.xml and STORE compression'
    supported_platforms = ['windows', 'osx', 'linux']
    author = 'eD! Thomas'
    version = (1, 0, 0)
    minimum_calibre_version = (6, 0, 0)

    # Entry point to the real plugin class defined in action.py
    actual_plugin = 'action:Azw3ToCbzAction'


