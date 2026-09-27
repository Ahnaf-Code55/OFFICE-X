#!/usr/bin/env python3
"""Lay out the three OFFICE-X floors using tiles already in office.tmj.

Run once against the checked-in maps with ``python3 tools/mapgen/redesign_floors.py``.
Furniture stamps are copied from the existing workstation, meeting table,
executive desk, and kitchen sprites so their multi-tile parts stay intact.
"""

import copy
import json
from pathlib import Path

MAPS = Path(__file__).resolve().parents[2] / 'src/renderer/src/assets/maps'
BASE = json.loads((MAPS / 'office.tmj').read_text())
W, H, TS = BASE['width'], BASE['height'], BASE['tilewidth']
SOURCE = {layer['name']: layer for layer in BASE['layers']}
FURNITURE = ('furniture-below', 'furniture-above')
CHAIRS = {289, 305}
GID_MASK = 0x1FFFFFFF


def at(x, y):
    return y * W + x


def layers(map_data):
    return {layer['name']: layer for layer in map_data['layers']}


def set_tile(map_data, name, x, y, gid):
    assert 0 <= x < W and 0 <= y < H
    layers(map_data)[name]['data'][at(x, y)] = gid


def stamp(map_data, source_rect, destination):
    sx, sy, width, height = source_rect
    dx, dy = destination
    for name in FURNITURE:
        src = SOURCE[name]['data']
        for row in range(height):
            for col in range(width):
                gid = src[at(sx + col, sy + row)]
                if gid:
                    set_tile(map_data, name, dx + col, dy + row, gid)


def interior_sprite(map_data, atlas_x, atlas_y, width, height, x, y):
    """Place one complete sprite from the existing 16-column interiors atlas."""
    for row in range(height):
        for col in range(width):
            set_tile(map_data, 'furniture-below', x + col, y + row,
                     1025 + (atlas_y + row) * 16 + atlas_x + col)


def office_sprite(map_data, atlas_x, atlas_y, width, height, x, y):
    """Place one complete sprite from the existing office atlas."""
    for row in range(height):
        for col in range(width):
            set_tile(map_data, 'furniture-below', x + col, y + row,
                     1 + (atlas_y + row) * 16 + atlas_x + col)


def point(name, x, y):
    return {'id': 0, 'name': name, 'point': True, 'x': x * TS, 'y': y * TS,
            'width': 0, 'height': 0, 'rotation': 0, 'type': '', 'visible': True}


def zone(name, x, y, width, height):
    return {'id': 0, 'name': name, 'x': x * TS, 'y': y * TS,
            'width': width * TS, 'height': height * TS,
            'rotation': 0, 'type': '', 'visible': True}


def vwall(map_data, x, y0, y1, doors=()):
    for y in range(y0, y1 + 1):
        if y not in doors:
            set_tile(map_data, 'walls', x, y, 611 if y == y0 else 643)


def hwall(map_data, y, x0, x1, doors=()):
    for x in range(x0, x1 + 1):
        if x not in doors:
            for row, gid in enumerate((522, 554, 570)):
                set_tile(map_data, 'walls', x, y + row, gid)


def rebuild_collision(map_data, seats):
    layer = layers(map_data)
    walls = layer['walls']['data']
    below = layer['furniture-below']['data']
    above = layer['furniture-above']['data']
    collision = layer['collision']['data']
    for index in range(W * H):
        collision[index] = int(bool(walls[index] or any(
            (data[index] & GID_MASK) not in (0, *CHAIRS) for data in (below, above))))
    for x, y in seats:
        assert not walls[at(x, y)], (x, y)
        collision[at(x, y)] = 0


def shell():
    map_data = copy.deepcopy(BASE)
    layer = layers(map_data)
    for name in ('floor', 'walls', 'furniture-below', 'furniture-above', 'collision'):
        layer[name]['data'] = [0] * (W * H)
    for y in range(3, H - 1):
        for x in range(1, W - 1):
            set_tile(map_data, 'floor', x, y, (783 if y % 2 else 799) + (x % 2 == 0))
    for x in range(1, W - 1):
        for y, gid in enumerate((522, 554, 570)):
            set_tile(map_data, 'walls', x, y, gid)
        set_tile(map_data, 'walls', x, H - 1, 579)
    for y in range(1, H - 1):
        set_tile(map_data, 'walls', 0, y, 530)
        set_tile(map_data, 'walls', W - 1, y, 533)
    for x, y, gid in ((0, 0, 514), (W - 1, 0, 517),
                      (0, H - 1, 578), (W - 1, H - 1, 581)):
        set_tile(map_data, 'walls', x, y, gid)
    # The existing window sprites fit the three-row outer wall.
    for x in (3, 10, 18, 27, 37, 43):
        stamp(map_data, (10, 1, 2, 2), (x, 1))
    return map_data


def workstation(map_data, points, name, x, y):
    # 3x4 workstation: monitor to the north, walkable chair at x+1,y+2.
    stamp(map_data, (1, 11, 3, 4), (x, y))
    points.append(point(name, x + 1, y + 2))


def finish(map_data, points, zones):
    layer = layers(map_data)
    layer['spawn-points']['objects'] = points
    layer['zones']['objects'] = zones
    seats = [(round(p['x'] / TS), round(p['y'] / TS)) for p in points
             if p['name'].startswith(('pc-', 'desk-'))]
    rebuild_collision(map_data, seats)
    object_id = 1
    for object_layer in ('spawn-points', 'zones'):
        for obj in layer[object_layer]['objects']:
            obj['id'] = object_id
            object_id += 1
    map_data['nextobjectid'] = object_id
    return map_data


def floor_two():
    m = shell()
    # Six closed rooms face a central corridor. The middle room on the north
    # side uses glass vertical partitions and a long conference table.
    hwall(m, 10, 1, 46, doors=(7, 8, 25, 26, 39, 40))
    hwall(m, 16, 1, 46, doors=(6, 7, 21, 22, 39, 40))
    for x in (18, 34):
        vwall(m, x, 3, 9)
    for x in (14, 30):
        vwall(m, x, 19, 28)

    points = []
    # Executive desk, windows and plants distinguish the corner office.
    stamp(m, (1, 3, 6, 5), (4, 4))
    points.append(point('desk-ceo', 6, 5))
    stamp(m, (29, 17, 3, 3), (14, 5))
    stamp(m, (10, 3, 7, 4), (22, 4))
    for x in (37, 42):
        workstation(m, points, 'desk-ciso' if x == 37 else 'pc-1', x, 4)
    for name, x in (('desk-hr', 3), ('pc-2', 8)):
        workstation(m, points, name, x, 21)
    for name, x in (('desk-finance', 17), ('pc-3', 24)):
        workstation(m, points, name, x, 21)
    for name, x in (('desk-operations', 33), ('pc-4', 39), ('pc-5', 43)):
        workstation(m, points, name, x, 21)
    # Filing cabinets furnish the support offices without turning them into
    # another open-plan workstation bay.
    stamp(m, (29, 17, 3, 3), (11, 25))
    stamp(m, (29, 17, 3, 3), (26, 24))
    stamp(m, (29, 17, 3, 2), (43, 13))  # corridor refreshment counter
    points.append(point('entrance', 21, 27))
    return finish(m, points, [
        zone('ceo-founder', 1, 3, 17, 7),
        zone('boardroom', 19, 3, 15, 7),
        zone('ciso-security', 35, 3, 12, 7),
        zone('human-resources', 1, 19, 13, 10),
        zone('finance', 15, 19, 15, 10),
        zone('operations', 31, 19, 16, 10),
    ])


def floor_three():
    m = shell()
    # Two enclosed meeting rooms, one broad studio, and a long lab separated
    # by a glass partition. Doors connect every room to the studio entrance.
    vwall(m, 12, 3, 9)
    hwall(m, 10, 1, 23, doors=(6, 7, 18, 19))
    vwall(m, 24, 3, 28, doors=(22, 23))
    stamp(m, (10, 3, 7, 4), (3, 4))
    stamp(m, (10, 3, 7, 4), (15, 4))
    # Studio workstations ring a shared design/review table.
    points = []
    for name, x in (('desk-product-director', 2), ('desk-product', 7),
                    ('desk-design', 12), ('pc-1', 19)):
        workstation(m, points, name, x, 14)
    for name, x in (('pc-2', 2), ('pc-3', 7), ('pc-4', 12), ('pc-5', 19)):
        workstation(m, points, name, x, 24)
    stamp(m, (10, 3, 7, 4), (8, 19))
    # Data/AI lab: repeated monitor desks, equipment bays and screen banks.
    for name, x, y in (('desk-data', 28, 5), ('desk-ai', 34, 5),
                       ('pc-6', 28, 13), ('pc-7', 34, 13),
                       ('pc-8', 28, 22), ('pc-9', 34, 22)):
        workstation(m, points, name, x, y)
    for y in (4, 10, 16, 22):
        office_sprite(m, 12, 17, 2, 2, 42, y)
        office_sprite(m, 14, 17, 2, 2, 44, y)
    for y in (5, 13, 21):
        interior_sprite(m, 12, 79, 2, 2, 38, y)
    stamp(m, (29, 17, 3, 2), (40, 25))  # lab refreshment counter
    points.append(point('entrance', 18, 28))
    return finish(m, points, [
        zone('meeting-room-a', 1, 3, 11, 7),
        zone('meeting-room-b', 13, 3, 11, 7),
        zone('product-design', 1, 13, 23, 16),
        zone('data-ai-lab', 25, 3, 22, 26),
    ])


def floor_one():
    m = copy.deepcopy(BASE)
    layer = layers(m)
    # Turn the lower desk bank into an open lobby. Keep the east annex desks.
    for y in range(24, 27):
        for x in range(5, 31):
            for name in FURNITURE:
                set_tile(m, name, x, y, 0)
    # The reception has its own entry and opens into the lobby through a door.
    for x in range(1, 34):
        if x not in (5, 6, 16, 17, 27, 28):
            set_tile(m, 'walls', x, 21, 570)
    for x in (19, 20, 23):
        set_tile(m, 'walls', x, 10, 570)  # short wall and a two-tile bay door
    vwall(m, 10, 22, 28, doors=(25,))
    hwall(m, 8, 34, 46)
    vwall(m, 33, 11, 28, doors=(15, 25))
    workstation_points = [p for p in layer['spawn-points']['objects']
                          if p['name'] not in {'desk-reception', 'entrance',
                                              'pc-9', 'pc-10', 'pc-11', 'pc-12', 'pc-13'}]
    for p in workstation_points:
        if p['name'] == 'warroom-seat':
            p['x'], p['y'] = 22 * TS, 9 * TS
    stamp(m, (1, 11, 3, 4), (3, 23))
    workstation_points.append(point('desk-reception', 4, 25))
    workstation_points.append(point('entrance', 5, 27))
    # Two complete sofas make the lobby a waiting area; the cafeteria stays
    # behind its own partition.
    interior_sprite(m, 1, 72, 3, 2, 14, 24)
    interior_sprite(m, 4, 72, 3, 2, 23, 24)
    zones = [z for z in layer['zones']['objects']
             if z['name'] not in {'reception', 'lobby', 'engineering-annex',
                                  'management-office', 'engineering', 'cafeteria'}]
    zones.extend((zone('management-office', 1, 3, 6, 5),
                  zone('engineering', 1, 11, 23, 10),
                  zone('cafeteria', 25, 12, 8, 9),
                  zone('reception', 1, 22, 9, 7),
                  zone('lobby', 11, 22, 22, 7),
                  zone('engineering-annex', 34, 11, 13, 18)))
    return finish(m, workstation_points, zones)


for filename, build in (('office.tmj', floor_one),
                        ('floor-2.tmj', floor_two),
                        ('floor-3.tmj', floor_three)):
    (MAPS / filename).write_text(json.dumps(build(), separators=(',', ':')) + '\n')
