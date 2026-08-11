import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'
/** Exercises parseSymbols across languages and asserts expected declarations. */
const { parseSymbols } = await import(pathToFileURL(`${BUILD}/parseSymbols.js`).href)

const CASES = [
  {
    language: 'typescript',
    file: 'a.ts',
    code: `export class OrderService {
  private readonly orders = new Map<string, Order>()
  async create(total: number): Promise<Order> {
    return { id: '1', total }
  }
  find(id: string): Order | undefined {
    return this.orders.get(id)
  }
}
export interface Order { id: string }
export type Money = number
export const MAX_ITEMS = 50
export const formatMoney = (m: Money) => String(m)
export function legacyFormat(m: Money) { return String(m) }
export enum Status { Open, Closed }
`,
    expect: [
      ['OrderService', 'class', ''],
      ['create', 'method', 'OrderService'],
      ['find', 'method', 'OrderService'],
      ['Order', 'interface', ''],
      ['Money', 'type', ''],
      ['MAX_ITEMS', 'constant', ''],
      ['formatMoney', 'function', ''],
      ['legacyFormat', 'function', ''],
      ['Status', 'enum', ''],
    ],
  },
  {
    language: 'python',
    file: 'a.py',
    code: `MAX_RETRIES = 3

class OrderRepo:
    def __init__(self, db):
        self.db = db

    async def find_by_id(self, order_id):
        return None

def module_level():
    pass
`,
    expect: [
      ['MAX_RETRIES', 'constant', ''],
      ['OrderRepo', 'class', ''],
      ['__init__', 'method', 'OrderRepo'],
      ['find_by_id', 'method', 'OrderRepo'],
      ['module_level', 'function', ''],
    ],
  },
  {
    language: 'go',
    file: 'a.go',
    code: `package orders

type Order struct {
	ID    string
	Total int
}

type Repo interface {
	Find(id string) (*Order, error)
}

const MaxItems = 50

func NewRepo(db *sql.DB) *repo {
	return &repo{db}
}

func (r *repo) Find(id string) (*Order, error) {
	return nil, nil
}
`,
    expect: [
      ['Order', 'struct', ''],
      ['Repo', 'interface', ''],
      ['MaxItems', 'constant', ''],
      ['NewRepo', 'function', ''],
      ['Find', 'method', ''],
    ],
  },
  {
    language: 'rust',
    file: 'a.rs',
    code: `pub struct Order {
    pub id: String,
}

pub trait Repository {
    fn find(&self, id: &str) -> Option<Order>;
}

impl Repository for PgRepo {
    fn find(&self, id: &str) -> Option<Order> {
        None
    }
}

pub fn new_repo() -> PgRepo { PgRepo }
pub const MAX: usize = 50;
`,
    expect: [
      ['Order', 'struct', ''],
      ['Repository', 'trait', ''],
      ['find', 'method', 'Repository'],
      ['new_repo', 'function', ''],
      ['MAX', 'constant', ''],
    ],
  },
  {
    language: 'java',
    file: 'A.java',
    code: `package com.acme.orders;

public class OrderService {
    private final OrderRepo repo;

    public Order create(int total) throws Exception {
        return null;
    }

    private static String format(int cents) {
        return "";
    }
}

interface OrderRepo {
}
`,
    expect: [
      ['OrderService', 'class', ''],
      ['create', 'method', 'OrderService'],
      ['format', 'method', 'OrderService'],
      ['OrderRepo', 'interface', ''],
    ],
  },
  {
    language: 'ruby',
    file: 'a.rb',
    code: `MAX_ITEMS = 50

class OrderService
  attr_accessor :repo

  def create(total)
    nil
  end

  def self.build
    new
  end
end
`,
    expect: [
      ['MAX_ITEMS', 'constant', ''],
      ['OrderService', 'class', ''],
      ['repo', 'property', 'OrderService'],
      ['create', 'method', 'OrderService'],
      ['build', 'method', 'OrderService'],
    ],
  },
  {
    language: 'swift',
    file: 'a.swift',
    code: `public struct Order {
    public let id: String
}

public protocol Repository {
    func find(id: String) -> Order?
}

extension Repository {
    public func findAll() -> [Order] { [] }
}
`,
    expect: [
      ['Order', 'class', ''],
      ['Repository', 'interface', ''],
      ['find', 'method', 'Repository'],
      ['findAll', 'method', 'Repository'],
    ],
  },
  {
    language: 'csharp',
    file: 'A.cs',
    code: `namespace Acme.Orders;

public class OrderService
{
    public Order Create(int total)
    {
        return null;
    }

    private readonly IRepo _repo;
}

public interface IRepo { }
`,
    expect: [
      ['OrderService', 'class', ''],
      ['Create', 'method', 'OrderService'],
      ['IRepo', 'interface', ''],
    ],
  },
  {
    language: 'php',
    file: 'a.php',
    code: `<?php
namespace Acme;

class OrderService {
    private $repo;
    const MAX = 50;

    public function create($total) {
        return null;
    }
}
`,
    expect: [
      ['OrderService', 'class', ''],
      ['repo', 'property', 'OrderService'],
      ['MAX', 'constant', 'OrderService'],
      ['create', 'method', 'OrderService'],
    ],
  },
  {
    language: 'cpp',
    file: 'a.cpp',
    code: `namespace acme {

class OrderService {
public:
    Order create(int total) {
        return Order{};
    }
};

struct Order {
    std::string id;
};

}
`,
    expect: [
      ['acme', 'module', ''],
      ['OrderService', 'class', 'acme'],
      ['create', 'method', 'OrderService'],
      ['Order', 'struct', 'acme'],
    ],
  },
]

let pass = 0
let fail = 0

for (const testCase of CASES) {
  const found = parseSymbols(testCase.file, testCase.language, testCase.code)
  const key = (s) => `${s.name}|${s.kind}|${s.container}`
  const foundKeys = new Set(found.map(key))

  const missing = testCase.expect.filter(
    ([name, kind, container]) => !foundKeys.has(`${name}|${kind}|${container}`),
  )

  if (missing.length === 0) {
    pass++
    console.log(`  PASS  ${testCase.language.padEnd(12)} ${found.length} symbols`)
  } else {
    fail++
    console.log(`  FAIL  ${testCase.language}`)
    for (const [name, kind, container] of missing) {
      const actual = found.filter((s) => s.name === name)
      console.log(
        `        expected ${name} (${kind}${container ? ` in ${container}` : ''}) — got ` +
          (actual.length ? actual.map(key).join(', ') : 'nothing'),
      )
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
