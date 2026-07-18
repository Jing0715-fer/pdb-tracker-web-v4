Write 工具在当前模式下需要权限批准。我将直接输出完整报告供您保存。

---

## 靶点间相关性分析报告

---

### 一、靶点概览

| 属性 | 靶点 1 | 靶点 2 |
|------|--------|--------|
| **UniProt ID** | P00533 | P07766 |
| **蛋白名称** | Epidermal growth factor receptor (EGFR) | T-cell surface glycoprotein CD3 epsilon chain (CD3ε) |
| **PDB 结构数** | 388 | 44 |
| **总体评分** | 7/10 | 6/10 |
| **X-ray 结构** | 364 条 (评分 10/10) | 7 条 (评分 4/10) |
| **Cryo-EM 结构** | 18 条 (评分 7/10) | 36 条 (评分 10/10) |
| **NMR 结构** | 6 条 (评分 4/10) | 1 条 (评分 3/10) |

**P00533 (EGFR)** 是 ErbB 受体酪氨酸激酶 (RTK) 家族成员，调控细胞增殖、分化和存活。388 条结构中 X-ray 占比 93.8%，反映其胞外域和激酶域非常适合结晶学研究。EGFR 是非小细胞肺癌、结直肠癌、胶质母细胞瘤等多种实体瘤的关键驱动靶点。

**P07766 (CD3ε)** 是 T 细胞受体复合物的核心亚基，与 CD3γ/δ/ζ 共同组成 CD3 复合物，负责 TCR 信号转导。44 条结构中 Cryo-EM 占比 81.8%，反映其功能依赖于多亚基复合物的完整构象。CD3ε 是 T 细胞免疫治疗的核心靶点。

---

### 二、共有结构分析

两个靶点共有 6 个 PDB 结构，全部为 **Cryo-EM 结构**：

| PDB ID | 方法 | 分辨率 | 描述 |
|--------|------|--------|------|
| 9IP8 | Cryo-EM | 3.9Å | Poly-alanine model for HL-type bispecific diabody Ex3 complex |
| 9IP9 | Cryo-EM | 3.6Å | Poly-alanine model for HL-type bispecific diabody Ex3 complex |
| 9IPA | Cryo-EM | 3.9Å | Poly-alanine model for HL-type bispecific diabody Ex3 complex |
| 9IPC | Cryo-EM | 3.4Å | Poly-alanine model for LH-type bispecific diabody Ex3 complex |
| 9IPD | Cryo-EM | 3.3Å | Poly-alanine model for LH-type bispecific diabody Ex3 complex |
| 9IPE | Cryo-EM | 3.3Å | Poly-alanine model for LH-type bispecific diabody Ex3 complex |

**关键推断：**

1. **双特异性抗体 (Bispecific Diabody) 架构** — "Ex3 bispecific diabody" 是一种同时靶向 EGFR 和 CD3ε 的双特异性双体分子。"HL-type" 和 "LH-type" 代表重链-轻链的两种 domain-swapping 取向，影响双抗的整体几何构型。

2. **T 细胞衔接器策略** — 共有结构揭示的核心设计是 **EGFR×CD3 T-cell engager**：一端结合肿瘤细胞表面的 EGFR，另一端结合 T 细胞表面的 CD3ε，将细胞毒性 T 细胞定向招募至肿瘤细胞处，触发免疫突触形成和肿瘤杀伤。

3. **结构质量**：分辨率 3.3-3.9Å，属中等分辨率，足以确定 domain 间相对取向和结合界面。"poly-alanine model" 提示可能进行了主链简化建模。

4. **与代表性结构的关系**：EGFR 代表性结构 (9VV1, 9Z2H) 聚焦于与小分子抑制剂或单特异性 Fab 的复合物；CD3ε 代表性结构 (9IRS, 9IRU) 聚焦于 TCR-CD3 与激动性抗体的复合物。而共有结构填补了两者之间的桥梁。

---

### 三、功能与通路关联

**天然生物学关联：无**

EGFR 和 CD3ε 在天然条件下**不属于同一信号通路或蛋白家族**，且不共表达于同一细胞：
- EGFR 在上皮细胞中表达，驱动 MAPK、PI3K-AKT、JAK-STAT 等增殖/存活信号通路。
- CD3ε 仅在 T 淋巴细胞中表达，作为 TCR-CD3 复合物的组分启动 LCK → ZAP70 → LAT 免疫信号级联。

**治疗性关联：免疫肿瘤学桥梁**

共有结构揭示的是**人工工程化的功能连接**——利用 EGFR×CD3 双特异性抗体在 EGFR+ 肿瘤细胞和 CD3+ T 细胞之间建立免疫突触。这是 BiTE/Cell Engager 类免疫治疗的核心机制：

```
EGFR(+) 肿瘤细胞 ←→ [Ex3 Bispecific Diabody] ←→ CD3(+) T 细胞
     ↓                                              ↓
  肿瘤抗原识别                                 T 细胞活化
     ↓                                              ↓
                                             穿孔素/颗粒酶释放
                                                   ↓
                                             肿瘤细胞凋亡
```

**信号通路交叉**：EGFR 信号影响细胞周期和凋亡调控；CD3ε 信号触发穿孔素/颗粒酶释放和 FasL 凋亡途径——在双特异性抗体介导下，两个独立通路在肿瘤死亡终点上会聚。

---

### 四、结构相似性推断

**一级结构与折叠类型：极低相似性**
- EGFR 胞外域含有 β-螺旋和半胱氨酸重复区，激酶域为典型的蛋白激酶折叠 (N-lobe + C-lobe)。
- CD3ε 胞外域为免疫球蛋白样 (Ig-like) β-三明治折叠，结构规模远小于 EGFR。
- 两者在序列、折叠和结构域组成上无显著同源性。

**共有结构揭示的"功能性结构关联"：**

共有结构 (9IP8-9IPE) 揭示的不是结构同源性，而是两者在双抗复合物中的**空间排布关系**。关键结构参数包括：
- **抗原间距**：双抗两臂间的空间跨度决定 T 细胞-肿瘤细胞免疫突触几何。
- **HL vs. LH 取向**：改变 Fab 臂相对取向，直接影响 TCR 聚集和 T 细胞活化强度。
- **膜近端距离**：决定两细胞膜间距，是 T 细胞活化的关键几何参数。

**对药物设计的启示：**

| 方面 | 启示 |
|------|------|
| 双抗工程 | HL/LH 取向可调控免疫突触几何，为优化效力提供结构基础 |
| 表位组合 | EGFR 表位与 CD3ε 表位的位置关系决定双抗的整体几何约束 |
| 亲和力平衡 | CD3 臂需中等亲和力 (KD ~10-100 nM) 以避免 CRS；EGFR 臂可高亲和力 |
| 交叉研究 | 该策略可推广至 HER2×CD3、PSMA×CD3 等其他肿瘤抗原的双抗设计 |
| 耐药研究 | EGFR 突变 (C797S, T790M, Del19) 对双抗结合的影响需结合突变结构评估 |

---

### 五、文献综合

> 本次分析未提供相关 PubMed 文献 PMID 列表。以下为基于结构元数据的推断。

**共有结构来源推断**：
- 来源期刊：**Cell Reports**
- 6 个结构极可能来自同一篇文章，描述 Ex3 bispecific diabody 与 EGFR、CD3ε 的三元复合物 Cryo-EM 结构
- HL-type (9IP8/9IP9/9IPA) 和 LH-type (9IPC/9IPD/9IPE) 两种 domain-swapping 构型被分别解析，为双抗几何构型-活性关系研究提供了直接的结构对比

**更广泛的文献背景**：
- EGFR 结构生物学始于 2002 年首个激酶域-抑制剂复合物，迄今 364 条 X-ray 结构覆盖了各种构象和突变型
- CD3ε 结构生物学随 Cryo-EM 分辨率革命加速：2019 年首个完整 TCR-CD3 复合物结构发表 (Dong et al., Nature 2019)
- EGFR×CD3 双抗结构是较新领域（2024-2025），AMG-596 (EGFRvIII×CD3 BiTE) 等分子正在临床前/临床评估中

**后续文献检索建议**：
- 通过 PDB 9IP8 页面的 "Primar