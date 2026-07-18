# 靶点间相关性分析报告

## 一、靶点概览

| 项目 | 靶点 1 | 靶点 2 |
|------|--------|--------|
| **UniProt ID** | P00533 | P07766 |
| **蛋白名称** | Epidermal growth factor receptor (EGFR) | T-cell surface glycoprotein CD3 epsilon chain |
| **基因** | *EGFR* (ERBB1, HER1) | *CD3E* |
| **蛋白家族** | 受体酪氨酸激酶 (ErbB家族) | 免疫球蛋白超家族 / CD3复合体 |
| **PDB 结构数** | 388 | 44 |
| **评分** | 7/10 | 6/10 |
| **代表性结构** | 以 Fab/小分子抑制剂复合物为主 | 以 Fab-TCR 复合物 / Cryo-EM 结构为主 |
| **主要结构方法** | X-RAY DIFFRACTION | ELECTRON MICROSCOPY |

- **P00533 (EGFR)** 是 ErbB 受体酪氨酸激酶家族的创始成员，在上皮细胞表面表达，调控细胞增殖、分化和存活。其胞外域结合 EGF/TGF-α 等配体后发生二聚化，激活胞内激酶域，驱动 RAS-MAPK、PI3K-AKT 等下游信号通路。EGFR 的过表达或激活性突变（L858R、exon 19 deletion、T790M、C797S 等）是多种实体瘤（非小细胞肺癌、结直肠癌、胶质母细胞瘤等）的核心驱动因素，是临床最成功的抗癌药物靶点之一。

- **P07766 (CD3 epsilon)** 是 T 细胞受体 (TCR) 复合体的关键信号亚基，与 CD3γ、CD3δ 和 CD3ζ 链共同组装成 TCR-CD3 复合体。CD3ε 胞内段含有免疫受体酪氨酸激活基序 (ITAM)，在 TCR 识别 MHC-抗原肽后被磷酸化，启动 T 细胞活化信号级联。CD3ε 是 T 细胞谱系标志物，在 T 细胞发育、免疫突触形成和获得性免疫应答中不可或缺。在肿瘤免疫治疗中，CD3ε 是最常用的 T 细胞招募靶点。

**结构数量差异的解释：** EGFR 作为成熟的小分子药物靶点（>20 年），拥有大量激酶域-抑制剂共晶结构和胞外域-抗体复合物结构，共 388 个；CD3ε 主要是作为多亚基 TCR-CD3 复合体的一部分被解析，多数为 Cryo-EM 结构，仅 44 个。

---

## 二、共有结构分析

### 2.1 共有结构列表

| PDB ID | 方法 | 分辨率 | 描述 |
|--------|------|--------|------|
| **9IP8** | ELECTRON MICROSCOPY | - | HL-type Ex3 diabody + sEGFR + CD3γε (closed conformation) |
| **9IP9** | ELECTRON MICROSCOPY | - | HL-type Ex3 diabody + sEGFR + CD3γε (middle conformation) |
| **9IPA** | ELECTRON MICROSCOPY | - | LH-type Ex3 diabody + sEGFR + CD3γε (open conformation) |
| **9IPC** | ELECTRON MICROSCOPY | - | LH-type Ex3 diabody + sEGFR + CD3γε (closed conformation) |
| **9IPD** | ELECTRON MICROSCOPY | - | LH-type Ex3 diabody + sEGFR + CD3γε (middle conformation) |
| **9IPE** | ELECTRON MICROSCOPY | - | (additional conformation variant) |

### 2.2 关键发现

这 6 个共有结构全部来源于同一项研究——**Ex3 双特异性 diabody 的三元复合物 Cryo-EM 结构**（发表于 *Cell Reports*, 2025），其核心组成要素为：

```
sEGFR (胞外域) —— Ex3 diabody —— CD3γε 异二聚体
     (528 Fab arm)      (OKT3 Fab arm)
```

**Ex3 diabody** 是一种非 IgG 格式的双特异性抗体，由两个 Fv 结构域通过短连接肽直接串联而成：
- **528 Fv**: 识别 EGFR 胞外域
- **OKT3 Fv**: 识别 CD3 epsilon

该系列结构的核心科学问题是**结构域排列顺序 (domain-order rearrangement) 如何影响双特异性抗体的活性**。研究比较了两种 format：
- **HL-type**: 重链-轻链型连接
- **LH-type**: 轻链-重链型连接

并对每种格式分别捕获了 **closed（闭合）、middle（中间）、open（开放）** 三种不同构象状态的三元复合体，共计 6 个结构。

### 2.3 共有结构的含义

| 推论 | 详细说明 |
|------|----------|
| **非天然关联** | 这 6 个共有结构反映的是**人工工程化的治疗性分子桥联**，而非两种蛋白在生理状态下的天然相互作用。EGFR 表达在肿瘤细胞表面，CD3ε 表达在 T 细胞表面，两者正常情况下位于完全不同的细胞类型上，没有直接接触或结合的生物学基础。 |
| **间接证据** | EGFR 与 CD3ε 在三维空间上通过双特异性 diabody 以 ~100-200 Å 的距离被桥接在一起，该距离接近免疫突触 (immunological synapse) 中 TCR 与其 pMHC 配体的间距范围，提示这种桥联架构能够在物理距离上模拟天然免疫突触信号。 |
| **构象动态学** | Closed/middle/open 三种构象状态表明 Ex3 diabody 在桥接两个靶蛋白时并非刚体连接，而是存在多自由度柔性排列，这可能直接影响 T 细胞的激活强度和细胞因子释放特征（CRS risk）。 |

---

## 三、功能与通路关联

### 3.1 天然通路对比

| 维度 | EGFR (P00533) | CD3ε (P07766) |
|------|---------------|----------------|
| **表达细胞** | 上皮细胞、肿瘤细胞 | T 淋巴细胞 |
| **分子功能** | 受体酪氨酸激酶 | 免疫受体信号转导亚基 |
| **所属复合体** | ErbB 同/异二聚体 | TCR-CD3 多亚基复合体 |
| **核心通路** | RAS-MAPK, PI3K-AKT, JAK-STAT | TCR 信号 → LCK/ZAP70 → LAT → NFAT/NF-κB/AP-1 |
| **生物学过程** | 细胞增殖、分化、迁移、存活 | T 细胞活化、克隆扩增、效应功能 |
| **疾病关联** | 多种实体瘤（肺癌、结直肠癌、头颈癌等） | 免疫缺陷、自身免疫病、T 细胞淋巴瘤 |

### 3.2 天然联系：存在 → 间接

在天然生理条件下，EGFR 和 CD3ε 之间的关联是**间接且功能对立的**：

1. **T 细胞依赖性肿瘤免疫监视**: 肿瘤细胞上的 EGFR 信号可以上调 PD-L1 表达等免疫抑制因子，间接抑制 T 细胞活化（而 T 细胞活化本身依赖 CD3ε 信号）。因此两者在肿瘤微环境中存在**拮抗性的调控关系**。

2. **免疫突触中的空间重构**: T 细胞通过 TCR-CD3 复合体识别肿瘤细胞上的 MHC-抗原肽，这一过程与 EGFR 在肿瘤细胞侧没有任何直接分子连接——两者仅通过"T 细胞-肿瘤细胞"细胞对在同一空间中同时存在。

### 3.3 工程化通路关联：Bispecific T cell Engager

通过双特异性抗体技术，EGFR 和 CD3ε 被赋予了人工的功能耦合关系：

```
[肿瘤细胞] EGFR ← 528 arm — Ex3 — OKT3 arm → CD3ε [T 细胞]
                          ↓
               T 细胞被物理招募至肿瘤细胞
                          ↓
            CD3ε 聚集 → ITAM 磷酸化 → T 细胞活化
                          ↓
            T 细胞释放穿孔素/颗粒酶 → 肿瘤细胞凋亡
```

这是一种"免疫突触工程化"策略，利用 **CD3ε 的强效 T 细胞激活能力** 与 **EGFR 的肿瘤选择性表达**，实现以下效应：

- **MHC 非依赖性**: 绕过 TCR 对抗原肽-MHC 的识别，直接通过 CD3ε 交联激活 T 细胞
- **肿瘤杀伤导向性**: 确保 T 细胞毒性效应集中在 EGFR 阳性肿瘤细胞上
- **旁观者效应**: 某些格式可触发上皮肿瘤细胞间的间隙连接依赖性杀伤传播