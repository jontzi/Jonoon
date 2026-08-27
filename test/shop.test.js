const test = require('node:test');
const assert = require('node:assert/strict');
const { publicShop, employeeQueueView } = require('../server');

test('maps and selects an employee-specific queue', () => {
  const shop = publicShop({
    id: 98,
    name: 'Kivistö',
    city: 'Vantaa',
    open: true,
    queue_state: 'open',
    queue_info: { clients_in_queue: 2, queue_employees: 2 },
    service_time_estimates: [{ wait_time: 19 }],
    queues: [{
      barber: { id: 973610, full_name: 'Verona Tavi' },
      wait_time: 68,
      queue_length: 1,
      queue_open: true
    }]
  });
  const selected = employeeQueueView(shop, 973610);
  assert.equal(selected.waitMinutes, 68);
  assert.equal(selected.selectedBarberName, 'Verona Tavi');
  assert.equal(selected.clientsInQueue, 1);
  assert.equal(selected.staffCount, 1);
});
